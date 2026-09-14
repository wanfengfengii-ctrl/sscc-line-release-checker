import { describe, expect, it } from 'vitest';
import { SSCC_PATTERN, computeCheckDigit, evaluateBatch, evaluateLine } from './sscc';

describe('computeCheckDigit（GS1 Mod 10 边界）', () => {
  it('加权和整除 10 时校验位为 0 而非 10', () => {
    expect(computeCheckDigit('00000000000000000')).toBe(0);
    expect(computeCheckDigit('00614141123456789')).toBe(0);
  });

  it('从载荷最右位起权重依次为 3、1、3、1', () => {
    // 最右位权重 3：1×3=3 → (10-3) mod 10 = 7
    expect(computeCheckDigit('00000000000000001')).toBe(7);
    // 右起第二位权重 1：1×1=1 → 9
    expect(computeCheckDigit('00000000000000010')).toBe(9);
    // 两位同时参与可区分权重顺序：2×3+1×1=7 → 3（若颠倒为 1、3 则是 2×1+1×3=5 → 5）
    expect(computeCheckDigit('00000000000000012')).toBe(3);
  });

  it('权重模式贯穿全部 17 位（最左位权重为 3，次左位为 1）', () => {
    expect(computeCheckDigit('10000000000000000')).toBe(7); // 1×3
    expect(computeCheckDigit('01000000000000000')).toBe(9); // 1×1
  });

  it('前导零以字符串形态保留并参与运算', () => {
    expect(computeCheckDigit('00000000000000003')).toBe(1); // 3×3=9 → 1
    expect(computeCheckDigit('99999999999999999')).toBe(5); // 加权和 315 → 5
    expect(computeCheckDigit('12345678901234567')).toBe(5); // 加权和 155 → 5
  });
});

describe('SSCC_PATTERN（声明式正则：恰好 18 个 ASCII 数字）', () => {
  it.each(['123456789012345675', '000000000000000000', '006141411234567890'])(
    '接受 %s',
    (value) => {
      expect(SSCC_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    ['仅 17 位', '12345678901234567'],
    ['19 位', '1234567890123456759'],
    ['含字母', '12345678901234567A'],
    ['前导空格', ' 123456789012345675'],
    ['尾部空格', '123456789012345675 '],
    ['阿拉伯-印度数字', '١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨'],
    ['全角数字', '１２３４５６７８９０１２３４５６７８'],
  ])('拒绝：%s', (_label, value) => {
    expect(SSCC_PATTERN.test(value)).toBe(false);
  });
});

describe('evaluateLine', () => {
  it('合格行返回实收与计算校验位', () => {
    expect(evaluateLine('123456789012345675', 1)).toEqual({
      lineNumber: 1,
      raw: '123456789012345675',
      status: 'ok',
      received: 5,
      computed: 5,
    });
  });

  it('前导零载荷的合格行', () => {
    const result = evaluateLine('006141411234567890', 7);
    expect(result).toMatchObject({ status: 'ok', received: 0, computed: 0 });
    expect(result.raw.startsWith('00')).toBe(true);
  });

  it('校验位不符时同时给出实收值与计算值', () => {
    const result = evaluateLine('006141411234567891', 4);
    expect(result.status).toBe('check-error');
    expect(result.received).toBe(1);
    expect(result.computed).toBe(0);
  });

  it('格式错误时不产生校验位', () => {
    expect(evaluateLine('12345', 2)).toEqual({
      lineNumber: 2,
      raw: '12345',
      status: 'format-error',
      received: null,
      computed: null,
    });
  });
});

describe('evaluateBatch', () => {
  it('空输入明确拒绝放行', () => {
    const result = evaluateBatch('');
    expect(result.hasLines).toBe(false);
    expect(result.canRelease).toBe(false);
    expect(result.lines).toEqual([]);
  });

  it.each(['\n\n\n', '   \n\t\n  \r\n  '])('仅含空行明确拒绝放行：%j', (input) => {
    const result = evaluateBatch(input);
    expect(result.hasLines).toBe(false);
    expect(result.canRelease).toBe(false);
  });

  it('忽略空行并保留非空行的原始行号', () => {
    const result = evaluateBatch('\n123456789012345675\n\n\n006141411234567890\n');
    expect(result.lines.map((line) => line.lineNumber)).toEqual([2, 5]);
    expect(result.canRelease).toBe(true);
  });

  it('兼容 CRLF 与 CR 换行', () => {
    const result = evaluateBatch('123456789012345675\r\n006141411234567890\r000000000000000000');
    expect(result.lines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
    expect(result.canRelease).toBe(true);
  });

  it('任一行失败则整批阻断并定位首个问题行', () => {
    const result = evaluateBatch('123456789012345675\nabc\n006141411234567891');
    expect(result.canRelease).toBe(false);
    expect(result.firstProblemLine).toBe(2);
  });

  it('首个问题行取行号最小者', () => {
    const result = evaluateBatch('006141411234567891\n12345');
    expect(result.firstProblemLine).toBe(1);
  });

  it('全部非空行合格时才放行', () => {
    expect(evaluateBatch('123456789012345675\n006141411234567890').canRelease).toBe(true);
    expect(evaluateBatch('123456789012345675\n006141411234567891').canRelease).toBe(false);
  });
});
