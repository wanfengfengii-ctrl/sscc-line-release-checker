/**
 * SSCC-18 出库复核核心逻辑。
 *
 * 格式判断完全交给声明式正则 SSCC_PATTERN，不实现任何自定义格式解释算法。
 * 唯一自定义算法是 GS1 Mod 10 校验位：从载荷最右位起依次乘 3、1、3、1……，
 * 取 (10 - (加权和 mod 10)) mod 10。
 */

/** 恰好 18 个 ASCII 数字。 */
export const SSCC_PATTERN = /^[0-9]{18}$/;

export type LineStatus = 'ok' | 'format-error' | 'check-error';

export interface LineResult {
  /** 原始行号（从 1 开始，被忽略的空行也占用行号）。 */
  lineNumber: number;
  /** 原始行内容，未做任何裁剪。 */
  raw: string;
  status: LineStatus;
  /** 实收校验位（第 18 位）；格式错误时为 null。 */
  received: number | null;
  /** 按前 17 位载荷算出的校验位；格式错误时为 null。 */
  computed: number | null;
}

export interface BatchResult {
  /** 每个非空行一条结果，按原始行号升序。 */
  lines: LineResult[];
  /** 是否存在至少一个非空行。 */
  hasLines: boolean;
  /** 首个未通过行的原始行号；全部通过或无行时为 null。 */
  firstProblemLine: number | null;
  /** 仅当存在非空行且全部合格时为 true。 */
  canRelease: boolean;
}

/**
 * 计算 17 位载荷的校验位。
 * 载荷以字符串形态传入，前导零原样参与运算。
 */
export function computeCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** 校验单个非空行。 */
export function evaluateLine(raw: string, lineNumber: number): LineResult {
  if (!SSCC_PATTERN.test(raw)) {
    return { lineNumber, raw, status: 'format-error', received: null, computed: null };
  }
  const payload = raw.slice(0, 17); // 保持字符串形态，保留前导零
  const received = raw.charCodeAt(17) - 48;
  const computed = computeCheckDigit(payload);
  return {
    lineNumber,
    raw,
    status: received === computed ? 'ok' : 'check-error',
    received,
    computed,
  };
}

/**
 * 评估整批输入：忽略空行（含纯空白行），非空行保留原始行号。
 * 空输入或仅含空行时 hasLines 为 false，调用方必须拒绝放行。
 */
export function evaluateBatch(input: string): BatchResult {
  const lines = input
    .split(/\r\n|\r|\n/)
    .map((raw, index) => ({ raw, lineNumber: index + 1 }))
    .filter(({ raw }) => raw.trim() !== '')
    .map(({ raw, lineNumber }) => evaluateLine(raw, lineNumber));

  const firstProblem = lines.find((line) => line.status !== 'ok') ?? null;
  return {
    lines,
    hasLines: lines.length > 0,
    firstProblemLine: firstProblem ? firstProblem.lineNumber : null,
    canRelease: lines.length > 0 && firstProblem === null,
  };
}
