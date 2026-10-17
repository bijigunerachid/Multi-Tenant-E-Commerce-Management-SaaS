import { csvCell, csvRow } from './csv.js';

describe('csv', () => {
  test('quotes cells containing separators, quotes or line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Haddad, Amina')).toBe('"Haddad, Amina"');
    expect(csvCell('5" screen')).toBe('"5"" screen"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-10-15T10:00:00Z'))).toBe('2026-10-15T10:00:00.000Z');
  });

  test('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell('+212600000000')).toBe("'+212600000000");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  test('rows end with CRLF', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });
});
