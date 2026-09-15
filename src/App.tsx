import { FormEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildProblemCursor,
  firstProblemIndex,
  nextProblemIndex,
  prevProblemIndex,
} from './problems';
import { BatchResult, LineResult, evaluateBatch } from './sscc';
import { useFocusMountedRow, useRowWindow } from './windowing';

const STATUS_LABEL: Record<LineResult['status'], string> = {
  ok: '通过',
  'format-error': '格式错误：须为恰好 18 个数字',
  'check-error': '校验位不符',
  duplicate: '重复',
};

function statusText(line: LineResult): string {
  if (line.status === 'check-error') {
    return `校验位不符：实收 ${line.received}，应为 ${line.computed}`;
  }
  if (line.status === 'duplicate') {
    return `与第 ${line.duplicateOf} 行重复`;
  }
  return STATUS_LABEL[line.status];
}

function Verdict({ result }: { result: BatchResult }) {
  if (!result.hasLines) {
    return (
      <p data-testid="verdict" data-state="empty" role="alert" className="verdict verdict-empty">
        拒绝放行：输入为空或仅含空行，没有可复核的 SSCC。
      </p>
    );
  }
  if (!result.canRelease) {
    const failed = result.lines.filter((line) => line.status !== 'ok').length;
    return (
      <p
        data-testid="verdict"
        data-state="blocked"
        role="alert"
        className="verdict verdict-blocked"
      >
        整批阻断：{failed} 行未通过（批内重复 {result.duplicateCount} 行），已聚焦首个问题行（第{' '}
        {result.firstProblemLine} 行），禁止放行。
      </p>
    );
  }
  return (
    <p data-testid="verdict" data-state="released" role="status" className="verdict verdict-ok">
      全部 {result.lines.length} 行校验通过，可送上传送带。
    </p>
  );
}

function ResultRow({
  line,
  isCurrentProblem,
  registerRow,
}: {
  line: LineResult;
  isCurrentProblem: boolean;
  registerRow: (lineNumber: number, node: HTMLTableRowElement | null) => void;
}) {
  return (
    <tr
      data-testid={`row-${line.lineNumber}`}
      data-row-index=""
      data-status={line.status}
      data-current-problem={isCurrentProblem ? '' : undefined}
      ref={(node) => registerRow(line.lineNumber, node)}
      tabIndex={isCurrentProblem ? -1 : undefined}
      className={isCurrentProblem ? 'current-problem' : undefined}
    >
      <td>{line.lineNumber}</td>
      <td>
        <code>{line.raw}</code>
      </td>
      <td data-testid="received">{line.received ?? '—'}</td>
      <td data-testid="computed">{line.computed ?? '—'}</td>
      <td>{statusText(line)}</td>
    </tr>
  );
}

/** 填充行：不承载数据，只在 tbody 内撑起已虚拟化部分的高度。 */
function SpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden="true" data-testid="spacer">
      <td colSpan={5} style={{ height, padding: 0, border: 'none' }} />
    </tr>
  );
}

export default function App() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<BatchResult | null>(null);
  // 每次提交一个新值，窗口据此回到顶部；输入修改时结果整体卸载，游标同步清除
  const [batchSeq, setBatchSeq] = useState(0);
  // 当前问题在问题序列中的序号（0 基）；null 表示没有待处理问题
  const [problemPos, setProblemPos] = useState<number | null>(null);

  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  // 领域结果仍保存全部非空行及原始行号；汇总与放行结论均基于完整批次
  const cursor = useMemo(() => (result ? buildProblemCursor(result) : null), [result]);
  // 原始行号 -> 结果数组下标。空行造成的行号间隔不能直接换算，滚动坐标走此映射
  const arrayIndexByLine = useMemo(() => {
    const map = new Map<number, number>();
    result?.lines.forEach((line, index) => map.set(line.lineNumber, index));
    return map;
  }, [result]);

  const { containerRef, rowWindow, scrollToIndex } = useRowWindow(
    result?.lines.length ?? 0,
    batchSeq,
  );

  const currentProblemLine =
    cursor && problemPos !== null ? (cursor.problems[problemPos]?.lineNumber ?? null) : null;

  // 新批次提交后，首个失败行可能在视口之外（前面有大量合格行），先滚动再由补焦效应聚焦
  useLayoutEffect(() => {
    if (!cursor || cursor.problems.length === 0) {
      return;
    }
    const firstLine = cursor.problems[0].lineNumber;
    const arrayIndex = arrayIndexByLine.get(firstLine);
    if (arrayIndex !== undefined) {
      scrollToIndex(arrayIndex);
    }
    // 仅在新批次提交时执行，浏览过程中点击“上一个/下一个问题”由 jumpToProblem 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSeq]);

  useFocusMountedRow(rowRefs, currentProblemLine, rowWindow.startIndex, rowWindow.endIndex);

  function registerRow(lineNumber: number, node: HTMLTableRowElement | null) {
    if (node) {
      rowRefs.current.set(lineNumber, node);
    } else {
      rowRefs.current.delete(lineNumber);
    }
  }

  function jumpToProblem(nextPos: number | null) {
    if (!cursor || nextPos === null) {
      return;
    }
    setProblemPos(nextPos);
    // 问题行可能尚未挂载：先按输入位置滚动，挂载后由 useFocusMountedRow 补焦
    const lineNumber = cursor.problems[nextPos].lineNumber;
    const arrayIndex = arrayIndexByLine.get(lineNumber);
    if (arrayIndex !== undefined) {
      scrollToIndex(arrayIndex);
    }
  }

  function handleChange(value: string) {
    setInput(value);
    setResult(null); // 输入改变，立即清除结果、窗口位置与问题游标
    setProblemPos(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const batch = evaluateBatch(input);
    setResult(batch);
    setBatchSeq((seq) => seq + 1);
    const initial = buildProblemCursor(batch);
    setProblemPos(firstProblemIndex(initial)); // 阻断后游标从首个失败行开始
  }

  const hasProblems = (cursor?.problems.length ?? 0) > 0;
  const atFirst = problemPos === null || problemPos === 0;
  const atLast = cursor === null || problemPos === null || problemPos >= cursor.problems.length - 1;
  const mountedLines =
    result && cursor ? result.lines.slice(rowWindow.startIndex, rowWindow.endIndex) : [];

  return (
    <main className="page">
      <h1>SSCC 出库复核</h1>
      <p className="hint">
        逐行粘贴或键入 18 位 SSCC（磨损标签请按实际识读结果补录），提交后整批判定能否放行。
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="sscc-input">SSCC 清单（每行一条，空行自动忽略）</label>
        <textarea
          id="sscc-input"
          data-testid="sscc-input"
          rows={10}
          value={input}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={'例如：\n006141411234567890\n123456789012345675'}
          spellCheck={false}
        />
        <button type="submit" data-testid="submit">
          复核并判定放行
        </button>
      </form>

      {result && cursor && (
        <section aria-live="polite">
          <Verdict result={result} />

          {result.hasLines && (
            <div className="problem-nav" data-testid="problem-nav">
              <button
                type="button"
                className="nav-button"
                data-testid="prev-problem"
                disabled={!hasProblems || atFirst}
                onClick={() =>
                  problemPos !== null && jumpToProblem(prevProblemIndex(cursor, problemPos))
                }
              >
                上一个问题
              </button>
              <button
                type="button"
                className="nav-button"
                data-testid="next-problem"
                disabled={!hasProblems || atLast}
                onClick={() =>
                  problemPos !== null && jumpToProblem(nextProblemIndex(cursor, problemPos))
                }
              >
                下一个问题
              </button>
              <span data-testid="problem-position" className="problem-position">
                {hasProblems && problemPos !== null
                  ? `问题 ${problemPos + 1} / ${cursor.problems.length}（第 ${cursor.problems[problemPos].lineNumber} 行）`
                  : '无待处理问题'}
              </span>
            </div>
          )}

          {result.lines.length > 0 && (
            <div className="table-scroll" data-testid="table-scroll" ref={containerRef}>
              <table>
                <thead>
                  <tr>
                    <th>行号</th>
                    <th>SSCC</th>
                    <th>实收校验位</th>
                    <th>计算校验位</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rowWindow.topSpacerHeight > 0 && <SpacerRow height={rowWindow.topSpacerHeight} />}
                  {mountedLines.map((line) => (
                    <ResultRow
                      key={line.lineNumber}
                      line={line}
                      isCurrentProblem={line.lineNumber === currentProblemLine}
                      registerRow={registerRow}
                    />
                  ))}
                  {rowWindow.bottomSpacerHeight > 0 && (
                    <SpacerRow height={rowWindow.bottomSpacerHeight} />
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
