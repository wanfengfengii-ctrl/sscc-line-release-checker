/**
 * 问题游标：在批次结果的问题行（status 非 ok）之间按输入位置跳转。
 *
 * 问题序号是问题行在“问题序列”中的 0 基下标，与原始行号是两套坐标：
 * 空行占用原始行号但不产生结果行，合格行产生结果行但不是问题，二者都会让
 * 原始行号与问题序号之间出现间隔。映射只能由按行号升序排列的问题行数组推导，
 * 不能用 lineNumber 直接换算。
 */
import { BatchResult, LineResult } from './sscc';

export interface ProblemCursor {
  /** 全部问题行，按原始行号升序（与输入位置一致）。 */
  problems: LineResult[];
  /** 原始行号 -> 问题序号（0 基）。 */
  indexByLine: Map<number, number>;
}

/** 从完整批次结果提取问题序列及行号映射。 */
export function buildProblemCursor(result: BatchResult): ProblemCursor {
  const problems = result.lines.filter((line) => line.status !== 'ok');
  const indexByLine = new Map<number, number>();
  problems.forEach((line, index) => {
    indexByLine.set(line.lineNumber, index);
  });
  return { problems, indexByLine };
}

/** 首个问题的问题序号；没有问题行时为 null。 */
export function firstProblemIndex(cursor: ProblemCursor): number | null {
  return cursor.problems.length > 0 ? 0 : null;
}

/** 上一个问题的序号；已在序列首位或没有问题时返回 null，不向尾部循环。 */
export function prevProblemIndex(cursor: ProblemCursor, current: number): number | null {
  if (cursor.problems.length === 0 || current <= 0) {
    return null;
  }
  return current - 1;
}

/** 下一个问题的序号；已在序列末尾或没有问题时返回 null，不向首部循环。 */
export function nextProblemIndex(cursor: ProblemCursor, current: number): number | null {
  if (cursor.problems.length === 0 || current < 0 || current >= cursor.problems.length - 1) {
    return null;
  }
  return current + 1;
}

/**
 * 稀疏原始行号 -> 问题序号。空行造成的行号间隔不得让游标错位，
 * 因此必须走问题序列映射，绝不能做 lineNumber - 1 之类的换算。
 */
export function problemIndexOfLine(cursor: ProblemCursor, lineNumber: number): number | null {
  const index = cursor.indexByLine.get(lineNumber);
  return index === undefined ? null : index;
}
