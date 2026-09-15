import { describe, expect, it } from 'vitest';
import {
  buildProblemCursor,
  firstProblemIndex,
  nextProblemIndex,
  prevProblemIndex,
  problemIndexOfLine,
} from './problems';
import { evaluateBatch } from './sscc';

describe('问题游标：稀疏原始行号到问题序号的映射', () => {
  it('空行与合格行都不占用问题序号，映射只按失败行在问题序列中的位置', () => {
    // 行 1：空行；行 2：校验错误；行 3、4：空行；行 5：格式错误；
    // 行 6：合格；行 7：合格；行 8：重复（与行 6）
    const input = [
      '',
      '006141411234567891', // 2 check-error  → 问题序号 0
      '',
      '',
      '12345', //              5 format-error → 问题序号 1
      '123456789012345675', // 6 ok
      '006141411234567890', // 7 ok
      '123456789012345675', // 8 duplicate of 6 → 问题序号 2
      '',
    ].join('\n');
    const cursor = buildProblemCursor(evaluateBatch(input));

    expect(cursor.problems.map((line) => line.lineNumber)).toEqual([2, 5, 8]);

    // 绝不能按 lineNumber - 1 换算：第 8 行是第 3 个问题（序号 2），不是 7
    expect(problemIndexOfLine(cursor, 2)).toBe(0);
    expect(problemIndexOfLine(cursor, 5)).toBe(1);
    expect(problemIndexOfLine(cursor, 8)).toBe(2);

    // 空行行号、合格行行号都不在映射中
    expect(problemIndexOfLine(cursor, 1)).toBeNull();
    expect(problemIndexOfLine(cursor, 3)).toBeNull();
    expect(problemIndexOfLine(cursor, 6)).toBeNull();
    expect(problemIndexOfLine(cursor, 7)).toBeNull();
    expect(problemIndexOfLine(cursor, 99)).toBeNull();
  });

  it('大量空行造成的行号间隔不改变问题序号', () => {
    const input = [
      ...Array.from({ length: 100 }, () => ''),
      '12345', // 行 101，唯一的问题行 → 问题序号 0
      ...Array.from({ length: 100 }, () => ''),
      '123456789012345675', // 行 202，合格
    ].join('\n');
    const cursor = buildProblemCursor(evaluateBatch(input));

    expect(cursor.problems).toHaveLength(1);
    expect(cursor.problems[0].lineNumber).toBe(101);
    expect(problemIndexOfLine(cursor, 101)).toBe(0);
    expect(firstProblemIndex(cursor)).toBe(0);
  });

  it('问题序号严格按输入位置（原始行号）升序，与失败类型无关', () => {
    // 行 2 校验错误、行 4 重复（与行 1）、行 6 格式错误
    const input =
      '123456789012345675\n' + // 1 ok
      '006141411234567891\n' + // 2 check-error
      '006141411234567890\n' + // 3 ok（与其他合格值不同）
      '123456789012345675\n' + // 4 duplicate of 1
      '000000000000000000\n' + // 5 ok
      'bad'; //                  6 format-error
    const cursor = buildProblemCursor(evaluateBatch(input));

    expect(cursor.problems.map((line) => line.lineNumber)).toEqual([2, 4, 6]);
    expect(cursor.problems.map((line) => line.status)).toEqual([
      'check-error',
      'duplicate',
      'format-error',
    ]);
    expect(problemIndexOfLine(cursor, 6)).toBe(2);
  });
});

describe('问题游标：首尾移动边界（不循环）', () => {
  function cursorFor(input: string) {
    return buildProblemCursor(evaluateBatch(input));
  }

  const THREE_PROBLEMS =
    'bad1\n' + // 1 format-error
    '123456789012345675\n' + // 2 ok
    'bad2\n' + // 3 format-error
    '006141411234567891\n' + // 4 check-error
    '006141411234567890'; //  5 ok（不同于第 2 行，不产生重复）

  it('首个失败行为问题序号 0', () => {
    const cursor = cursorFor(THREE_PROBLEMS);
    expect(cursor.problems.map((line) => line.lineNumber)).toEqual([1, 3, 4]);
    expect(firstProblemIndex(cursor)).toBe(0);
  });

  it('从首个问题继续“上一个”返回 null 而不是绕到尾部', () => {
    const cursor = cursorFor(THREE_PROBLEMS);
    expect(prevProblemIndex(cursor, 0)).toBeNull();
  });

  it('从末尾问题继续“下一个”返回 null 而不是绕回首部', () => {
    const cursor = cursorFor(THREE_PROBLEMS);
    expect(nextProblemIndex(cursor, 2)).toBeNull();
  });

  it('中间位置正常前后移动', () => {
    const cursor = cursorFor(THREE_PROBLEMS);
    expect(prevProblemIndex(cursor, 2)).toBe(1);
    expect(nextProblemIndex(cursor, 1)).toBe(2);
    expect(prevProblemIndex(cursor, 1)).toBe(0);
    expect(nextProblemIndex(cursor, 0)).toBe(1);
  });

  it('越界序号也被安全夹在首尾，不产生循环', () => {
    const cursor = cursorFor(THREE_PROBLEMS);
    expect(prevProblemIndex(cursor, -5)).toBeNull();
    expect(nextProblemIndex(cursor, 99)).toBeNull();
  });

  it('唯一问题行：前后都无法移动', () => {
    const cursor = cursorFor('123456789012345675\n12345');
    expect(firstProblemIndex(cursor)).toBe(0);
    expect(prevProblemIndex(cursor, 0)).toBeNull();
    expect(nextProblemIndex(cursor, 0)).toBeNull();
  });

  it('没有失败行（全部合格）时游标为空：首个序号为 null，任何移动都是 null，导航显示无待处理问题', () => {
    const cursor = cursorFor('123456789012345675\n006141411234567890');
    expect(cursor.problems).toEqual([]);
    expect(firstProblemIndex(cursor)).toBeNull();
    expect(prevProblemIndex(cursor, 0)).toBeNull();
    expect(nextProblemIndex(cursor, 0)).toBeNull();
  });
});
