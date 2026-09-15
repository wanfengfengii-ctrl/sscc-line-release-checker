import { expect, test } from '@playwright/test';

const VALID_A = '123456789012345675'; // 实收 5，计算 5
const VALID_B = '006141411234567890'; // 实收 0，计算 0（前导零）
const VALID_C = '000000000000000000';
const BAD_CHECK = '006141411234567891'; // 实收 1，计算 0

const LARGE_BATCH_SIZE = 30_000;

/**
 * 在页面内生成三万行批次并写入 textarea，再点击提交。
 * 直接走协议 fill 六万字符级文本会在参数序列化阶段超时，因此把生成逻辑
 * 放进浏览器执行，并用原生 value setter 触发 React 的受控 input 事件。
 * 混合错误按输入位置分布：第 100 行校验错误、第 5000 行格式错误、
 * 第 20000 行与第 1 行重复。
 */
async function submitLargeBatch(page: import('@playwright/test').Page): Promise<number[]> {
  await page.getByTestId('sscc-input').evaluate((el, validA) => {
    const checkDigit = (payload: string): number => {
      let sum = 0;
      for (let i = 0; i < payload.length; i += 1) {
        const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
        sum += digit * (i % 2 === 0 ? 3 : 1);
      }
      return (10 - (sum % 10)) % 10;
    };
    const validSscc = (seq: number): string => {
      const payload = String(seq).padStart(17, '0');
      return `${payload}${checkDigit(payload)}`;
    };
    const lines: string[] = [];
    for (let i = 1; i <= 30_000; i += 1) {
      lines.push(validSscc(i));
    }
    lines[0] = validA; // 第 1 行：重复项的首次出现
    lines[99] = '006141411234567891'; // 第 100 行：校验错误（首个问题）
    lines[4999] = '12345'; // 第 5000 行：格式错误
    lines[19999] = validA; // 第 20000 行：与第 1 行重复
    const textarea = el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, lines.join('\n'));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, VALID_A);
  await page.getByTestId('submit').click();
  return [100, 5000, 20000];
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('全部合格时提示可送上传送带，并逐行显示实收与计算校验位', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n\n${VALID_B}`);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'released');
  await expect(page.getByTestId('verdict')).toContainText('可送上传送带');

  // 第 2 行为空行被忽略，原始行号保留为 1 和 3
  await expect(page.getByTestId('row-2')).toHaveCount(0);
  const row1 = page.getByTestId('row-1');
  await expect(row1).toContainText('通过');
  await expect(row1.getByTestId('received')).toHaveText('5');
  await expect(row1.getByTestId('computed')).toHaveText('5');
  const row3 = page.getByTestId('row-3');
  await expect(row3).toContainText('通过');
  await expect(row3.getByTestId('received')).toHaveText('0');
  await expect(row3.getByTestId('computed')).toHaveText('0');
});

test('校验位错误：整批阻断、聚焦首个问题行并显示实收与计算值', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n${BAD_CHECK}`);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('verdict')).toContainText('整批阻断');

  const row2 = page.getByTestId('row-2');
  await expect(row2).toBeFocused();
  await expect(row2.getByTestId('received')).toHaveText('1');
  await expect(row2.getByTestId('computed')).toHaveText('0');
  await expect(row2).toContainText('实收 1');
  await expect(row2).toContainText('应为 0');
});

test('格式错误：整批阻断并聚焦首个问题行', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n12345\n${VALID_B}`);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  const row2 = page.getByTestId('row-2');
  await expect(row2).toBeFocused();
  await expect(row2).toContainText('格式错误');
});

test('空输入明确拒绝放行', async ({ page }) => {
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByTestId('verdict')).toContainText('拒绝放行');
});

test('仅含空行明确拒绝放行', async ({ page }) => {
  await page.getByTestId('sscc-input').fill('   \n\n\t\n');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByTestId('verdict')).toContainText('拒绝放行');
});

test('输入改变立即清除旧结论', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(VALID_A);
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'released');

  await page.getByTestId('sscc-input').fill(`${VALID_A}\n${VALID_B}`);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByTestId('row-1')).toHaveCount(0);
});

test('重新提交只显示当前批次的完整结果', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${BAD_CHECK}\n12345`);
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('row-2')).toContainText('格式错误');

  await page.getByTestId('sscc-input').fill(VALID_B);
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'released');
  await expect(page.getByTestId('row-1')).toContainText('通过');
  await expect(page.getByTestId('row-2')).toHaveCount(0);
});

test('逐行粘贴多条 SSCC 的真实批量流程', async ({ page }) => {
  const batch = ['000000000000000000', VALID_A, VALID_B].join('\n');
  await page.getByTestId('sscc-input').fill(batch);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toContainText('全部 3 行校验通过');
  await expect(page.getByTestId('verdict')).toContainText('可送上传送带');
});

test('批内重复：整批阻断、汇总重复行数并聚焦首个重复行', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n\n${VALID_A}`);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('verdict')).toContainText('整批阻断');
  await expect(page.getByTestId('verdict')).toContainText('批内重复 1 行');

  // 首次出现保留通过，跨空行的重复行显示“与第 N 行重复”并被聚焦
  await expect(page.getByTestId('row-1')).toContainText('通过');
  const row3 = page.getByTestId('row-3');
  await expect(row3).toContainText('与第 1 行重复');
  await expect(row3).toBeFocused();
});

test('重复批次修正重复项后恢复放行', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n${VALID_A}`);
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('row-2')).toContainText('与第 1 行重复');

  // 修改输入立即清除旧结论
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n${VALID_B}`);
  await expect(page.getByTestId('verdict')).toHaveCount(0);

  // 重新提交只反映当前文本：重复项已修正，整批放行
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'released');
  await expect(page.getByTestId('row-1')).toContainText('通过');
  await expect(page.getByTestId('row-2')).toContainText('通过');
});

test('普通批次放行：无待处理问题，首尾导航按钮均禁用', async ({ page }) => {
  await page.getByTestId('sscc-input').fill(`${VALID_A}\n\n${VALID_B}\n${VALID_C}`);
  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'released');
  await expect(page.getByTestId('problem-position')).toHaveText('无待处理问题');
  await expect(page.getByTestId('prev-problem')).toBeDisabled();
  await expect(page.getByTestId('next-problem')).toBeDisabled();
});

test('三万条结果：数据行 DOM 节点始终不超过 120 个，汇总仍基于完整批次', async ({ page }) => {
  await submitLargeBatch(page);

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'blocked');
  // 汇总数字来自完整批次（三万行，其中 3 个问题、1 个重复），不受窗口化影响
  await expect(page.getByTestId('verdict')).toContainText('3 行未通过');
  await expect(page.getByTestId('verdict')).toContainText('批内重复 1 行');

  const scroll = page.getByTestId('table-scroll');
  const mountedRows = page.locator('tbody tr[data-row-index]');

  // 首屏：自动滚动到首个问题行（第 100 行），挂载数仍有上限
  await expect(page.getByTestId('row-100')).toBeFocused();
  expect(await mountedRows.count()).toBeLessThanOrEqual(120);

  // 用键盘滚到底部附近，节点数依旧不超过上限，且行按需挂载/卸载
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId(`row-${LARGE_BATCH_SIZE}`)).toHaveCount(1);
  expect(await mountedRows.count()).toBeLessThanOrEqual(120);

  // 滚回中部再校验一次
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.5;
  });
  await expect(page.getByTestId('row-15000')).toHaveCount(1);
  expect(await mountedRows.count()).toBeLessThanOrEqual(120);

  // 填充行不属于数据行，数据行总数受窗口约束而非三万行全量挂载
  expect(await page.locator('tbody tr[data-testid="spacer"]').count()).toBeGreaterThanOrEqual(1);
});

test('问题导航：跳向屏外混合错误后准确聚焦，首尾禁用且不循环', async ({ page }) => {
  const problemLines = await submitLargeBatch(page);

  const prev = page.getByTestId('prev-problem');
  const next = page.getByTestId('next-problem');
  const position = page.getByTestId('problem-position');

  // 阻断后游标从首个失败行（第 100 行，校验错误）开始
  await expect(position).toHaveText('问题 1 / 3（第 100 行）');
  await expect(page.getByTestId('row-100')).toBeFocused();
  await expect(page.getByTestId('row-100')).toContainText('校验位不符');
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();

  // 跳到屏外第 5000 行（格式错误）：先滚动再聚焦，挂载行始终有上限
  await next.click();
  await expect(position).toHaveText('问题 2 / 3（第 5000 行）');
  await expect(page.getByTestId('row-5000')).toBeFocused();
  await expect(page.getByTestId('row-5000')).toContainText('格式错误');
  expect(await page.locator('tbody tr[data-row-index]').count()).toBeLessThanOrEqual(120);

  // 继续跳到屏外第 20000 行（与第 1 行重复），到达末尾后“下一个”禁用且不能循环
  await next.click();
  await expect(position).toHaveText('问题 3 / 3（第 20000 行）');
  await expect(page.getByTestId('row-20000')).toBeFocused();
  await expect(page.getByTestId('row-20000')).toContainText('与第 1 行重复');
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();

  // 反向跳回，最终停在首个问题；“上一个”禁用，焦点不循环到尾部
  await prev.click();
  await expect(position).toHaveText('问题 2 / 3（第 5000 行）');
  await expect(page.getByTestId('row-5000')).toBeFocused();
  await prev.click();
  await expect(position).toHaveText('问题 1 / 3（第 100 行）');
  await expect(page.getByTestId('row-100')).toBeFocused();
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();

  // 三个问题的原始行号恰为预期，空行/行号间隔逻辑不会让游标错位
  expect(problemLines).toEqual([100, 5000, 20000]);
});

test('空行造成的行号间隔不让问题游标错位', async ({ page }) => {
  // 第 3 行校验错误（前两行为空），第 4 行为空，第 5 行格式错误
  await page
    .getByTestId('sscc-input')
    .fill(`\n\n${BAD_CHECK}\n\n12345`);
  await page.getByTestId('submit').click();

  const position = page.getByTestId('problem-position');
  await expect(position).toHaveText('问题 1 / 2（第 3 行）');
  await expect(page.getByTestId('row-3')).toBeFocused();

  await page.getByTestId('next-problem').click();
  await expect(position).toHaveText('问题 2 / 2（第 5 行）');
  await expect(page.getByTestId('row-5')).toBeFocused();
  await expect(page.getByTestId('next-problem')).toBeDisabled();
});

test('导航与窗口状态在输入被修改时一并清除', async ({ page }) => {
  await submitLargeBatch(page);
  await expect(page.getByTestId('row-100')).toBeFocused();
  await page.getByTestId('next-problem').click();
  await expect(page.getByTestId('row-5000')).toBeFocused();

  // 输入一旦修改：结果、窗口位置、问题游标全部清除
  await page.getByTestId('sscc-input').fill(VALID_A);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByTestId('problem-nav')).toHaveCount(0);
  await expect(page.getByTestId('table-scroll')).toHaveCount(0);
  await expect(page.locator('tbody tr[data-row-index]')).toHaveCount(0);
});
