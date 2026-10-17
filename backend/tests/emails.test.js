import { jest } from '@jest/globals';
import { createTestApp, resetState } from './helpers/testApp.js';
import { apiClient } from './helpers/client.js';
import { createOrganization, organizationWithAllRoles, signIn } from './helpers/factories.js';
import { createEmailProcessor } from '../src/jobs/emailWorker.js';
import { EMAIL_ATTEMPTS } from '../src/jobs/emailQueue.js';

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetState(ctx));

const register = (email) =>
  apiClient(ctx.app).post('/auth/register', {
    name: 'Amina Haddad',
    email,
    password: 'a-long-enough-password',
  });
const deliveryTo = (to) => ctx.prisma.emailDelivery.findFirstOrThrow({ where: { toAddress: to } });
// What an SMTP server failure looks like from nodemailer.
const smtpError = (responseCode, message) => Object.assign(new Error(message), { responseCode });

describe('email queue', () => {
  test('an email is queued by the request, sent by the worker and recorded', async () => {
    const res = await register('amina@example.com');
    expect(res.status).toBe(201);
    // The request only queued it: the delivery exists before the worker has run.
    const queued = await deliveryTo('amina@example.com');
    expect(queued).toMatchObject({
      kind: 'auth.verify_email',
      subject: 'Confirm your email address',
      organizationId: null, // an account email belongs to no organization
    });

    await ctx.emails.drain();
    const sent = await deliveryTo('amina@example.com');
    expect(sent).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
    expect(sent.sentAt).toBeInstanceOf(Date);
    expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['amina@example.com']);
    // The job (which held the one-time link) is gone once sent.
    expect(await ctx.emails.queue.getJob(sent.id)).toBeUndefined();
  });

  test('temporary failures are retried until the email goes out', async () => {
    ctx.mailer.failNext(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
    ctx.mailer.failNext(smtpError(421, 'Service not available, try again later'));
    await register('retry@example.com');

    await ctx.emails.drain();
    expect(await deliveryTo('retry@example.com')).toMatchObject({
      status: 'SENT',
      attempts: 3,
      lastError: null,
      failedAt: null,
    });
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  test(`after ${EMAIL_ATTEMPTS} failed attempts the delivery is marked failed and the job removed`, async () => {
    ctx.mailer.failNext(smtpError(451, 'Temporary local problem'), EMAIL_ATTEMPTS);
    await register('down@example.com');

    await ctx.emails.drain();
    const failed = await deliveryTo('down@example.com');
    expect(failed).toMatchObject({
      status: 'FAILED',
      attempts: EMAIL_ATTEMPTS,
      lastError: '451 Temporary local problem',
      sentAt: null,
    });
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(await ctx.emails.queue.getJob(failed.id)).toBeUndefined();
  });

  test('a permanent rejection is not retried', async () => {
    ctx.mailer.failNext(smtpError(550, 'Mailbox unavailable'));
    await register('nobody@example.com');

    await ctx.emails.drain();
    expect(await deliveryTo('nobody@example.com')).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: '550 Mailbox unavailable',
    });
  });

  test('a request still succeeds when its email cannot be queued', async () => {
    const add = jest.spyOn(ctx.emails.queue, 'add').mockRejectedValueOnce(new Error('Redis down'));
    try {
      const res = await register('offline@example.com');
      expect(res.status).toBe(201);
      expect(await deliveryTo('offline@example.com')).toMatchObject({
        status: 'FAILED',
        attempts: 0,
        lastError: 'Could not be queued: Redis down',
      });
    } finally {
      add.mockRestore();
    }
  });

  test('a delivery that was already sent is not sent again', async () => {
    await register('once@example.com');
    await ctx.emails.drain();
    const delivery = await deliveryTo('once@example.com');

    // The same job delivered a second time (at-least-once queues can do this).
    const process = createEmailProcessor({
      prisma: ctx.prisma,
      mailer: ctx.mailer,
      logger: { warn() {} },
    });
    const job = {
      data: {
        deliveryId: delivery.id,
        message: { to: 'once@example.com', subject: 'x', text: 'x' },
      },
      attemptsMade: 0,
      opts: { attempts: EMAIL_ATTEMPTS },
    };
    expect(await process(job)).toBe('skipped');
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  test("the database refuses a status that disagrees with the delivery's timestamps", async () => {
    await register('check@example.com');
    await ctx.emails.drain();
    const { id } = await deliveryTo('check@example.com');
    await expect(
      ctx.prisma.$executeRaw`UPDATE email_deliveries SET status = 'FAILED' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/email_deliveries_status_check/);
  });
});

describe('delivery history', () => {
  test('owners see their organization deliveries, newest first, without message bodies', async () => {
    const org = await organizationWithAllRoles(ctx.app, ctx.prisma);
    const owner = org.members.OWNER.client;
    ctx.mailer.failNext(smtpError(550, 'Mailbox unavailable'));
    await owner.post('/members/invitations', { email: 'bounce@example.com', role: 'ANALYST' });
    await ctx.emails.drain();
    await owner.post('/members/invitations', { email: 'hire@example.com', role: 'ANALYST' });
    await ctx.emails.drain();

    // Another organization's invitation and an account email must not appear.
    const other = await createOrganization(ctx.prisma);
    const otherOwner = await signIn(ctx.app, other.owner);
    await otherOwner.post('/members/invitations', { email: 'theirs@example.com', role: 'ANALYST' });
    await register('account@example.com');
    await ctx.emails.drain();

    const res = await owner.get('/email-deliveries');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => [d.to, d.status, d.kind])).toEqual([
      ['hire@example.com', 'SENT', 'member.invitation'],
      ['bounce@example.com', 'FAILED', 'member.invitation'],
    ]);
    expect(res.body.data[1]).toMatchObject({ attempts: 1, lastError: '550 Mailbox unavailable' });
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      [
        'attempts',
        'createdAt',
        'failedAt',
        'id',
        'kind',
        'lastError',
        'sentAt',
        'status',
        'subject',
        'to',
      ].sort(),
    );
    expect(res.body.meta).toEqual({ page: 1, pageSize: 25, total: 2 });

    const failed = await owner.get('/email-deliveries?status=FAILED');
    expect(failed.body.data.map((d) => d.to)).toEqual(['bounce@example.com']);
  });

  test('only owners can read it, and a bad filter is refused', async () => {
    const org = await organizationWithAllRoles(ctx.app, ctx.prisma);
    for (const role of ['MANAGER', 'ANALYST', 'ORDER_MANAGER', 'INVENTORY_MANAGER']) {
      expect((await org.members[role].client.get('/email-deliveries')).status).toBe(403);
    }
    const bad = await org.members.OWNER.client.get('/email-deliveries?status=BOUNCED');
    expect(bad.status).toBe(400);
  });
});
