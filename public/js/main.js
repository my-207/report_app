/**
 * 主逻辑 — 页面初始化、全局状态管理、子树复制填充流程
 */

let isProcessing = false;

/** 页面初始化 */
document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  updateStep(1);
});

/** 更新步骤指示器 */
function updateStep(step) {
  const steps = document.querySelectorAll('.step');
  const lines = document.querySelectorAll('.step-line');

  steps.forEach((s, i) => {
    s.classList.remove('active', 'completed');
    if (i + 1 < step) s.classList.add('completed');
    if (i + 1 === step) s.classList.add('active');
  });

  lines.forEach((l, i) => {
    l.classList.toggle('completed', i + 1 < step);
  });
}

/** 开始填充 — 子树复制双源模式 */
async function startFill() {
  if (isProcessing) return;
  if (!templateSessionId || (!rjSessionId && !mdSessionId)) {
    showToast('请先上传模板和至少一个数据源文件', 'error');
    return;
  }

  isProcessing = true;
  const fillBtn = document.getElementById('fillBtn');
  fillBtn.disabled = true;
  fillBtn.textContent = '处理中...';

  // 显示进度区
  updateStep(3);
  const progressSection = document.getElementById('progressSection');
  progressSection.classList.remove('hidden');
  progressSection.classList.add('fade-in');
  document.getElementById('resultSection').classList.add('hidden');

  // 重置进度
  resetProgress();

  try {
    const hasBoth = rjSessionId && mdSessionId;
    setProgress(1, hasBoth ? '正在合并双源数据...' : '正在解析源数据...');
    await delay(600);

    setProgress(2, '正在匹配模板锚点位置...');
    await delay(600);

    setProgress(3, '正在复制章节内容和填充表格...');
    const result = await executeFillByCopy(
      templateSessionId,
      rjSessionId || null,
      mdSessionId || null
    );

    setProgressComplete();
    updateStep(4);
    showResult(result.data);
  } catch (err) {
    setProgressError();
    showResultError(err.message);
    showToast('填充失败: ' + err.message, 'error');
  } finally {
    isProcessing = false;
    fillBtn.disabled = false;
    fillBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      提交任务
    `;
  }
}

/** 设置进度 */
function setProgress(step, hint) {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach((s, i) => {
    s.classList.remove('active', 'completed', 'error');
    if (i + 1 < step) s.classList.add('completed');
    if (i + 1 === step) s.classList.add('active');
  });

  lines.forEach((l, i) => {
    l.classList.remove('active', 'completed');
    if (i + 1 < step) l.classList.add('completed');
    if (i + 1 === step) l.classList.add('active');
  });

  document.getElementById('progressHint').textContent = hint;
}

/** 进度完成 */
function setProgressComplete() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach(s => { s.classList.remove('active', 'error'); s.classList.add('completed'); });
  lines.forEach(l => { l.classList.remove('active'); l.classList.add('completed'); });
  document.getElementById('progressHint').textContent = '报告生成完成！';
}

/** 进度失败 */
function setProgressError() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  steps.forEach(s => { s.classList.remove('active', 'completed'); s.classList.add('error'); });
  document.getElementById('progressHint').textContent = '处理失败，请查看错误详情';
}

/** 重置进度 */
function resetProgress() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach(s => s.classList.remove('active', 'completed', 'error'));
  lines.forEach(l => l.classList.remove('active', 'completed'));
  document.getElementById('progressHint').textContent = '正在分析源文档章节结构...';
}

/** 显示成功结果 */
function showResult(data) {
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');

  const fillResult = data.fillResult || {};
  const stats = fillResult.stats || {};
  const subtreeStats = data.subtreeStats || {};
  const validation = fillResult.validation || {};

  // 校验状态
  const validationPassed = validation.passed !== false;
  const hasValidation = validation.passed !== undefined;

  // 构建统计项
  const statItems = [
    { value: subtreeStats.chaptersCopied || 0, label: '章节复制' },
    { value: subtreeStats.paragraphsInserted || 0, label: '段落插入' },
    { value: subtreeStats.tablesFilled || stats.tablesFilled || 0, label: '表格填充' },
    { value: subtreeStats.rowsInserted || stats.rowsInserted || 0, label: '数据行' },
    { value: subtreeStats.placeholdersReplaced || stats.placeholdersReplaced || 0, label: '占位符替换' },
  ];

  // 如果有键值对填充，追加显示
  const kvFilled = subtreeStats.keyValueCellsFilled || 0;
  if (kvFilled > 0) {
    statItems.push({ value: kvFilled, label: '键值对单元格' });
  }

  // 校验状态标记
  let validationHtml = '';
  if (hasValidation) {
    if (validationPassed) {
      validationHtml = `
        <div class="validation-badge validation-passed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          格式校验通过
        </div>`;
    } else {
      const errors = validation.errors || [];
      validationHtml = `
        <div class="validation-badge validation-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          格式校验失败
        </div>
        <div class="validation-errors">
          ${errors.map(e => `<div class="validation-error-item">${escapeHtml(e)}</div>`).join('')}
        </div>`;
    }
  }

  // 下载按钮（仅校验通过或无校验信息时显示）
  const downloadBtn = validationPassed
    ? `<button class="btn btn-success" onclick="downloadReport('${escapeHtml(fillResult.outputFileName || 'report.docx')}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        下载报告
      </button>`
    : `<div class="no-download-hint">格式校验未通过，无法下载</div>`;

  resultContent.innerHTML = `
    <div class="result-success fade-in">
      <div class="result-icon-success">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h3 class="result-title">报告生成成功</h3>
      <p class="result-filename">${escapeHtml(fillResult.outputFileName || 'report.docx')}</p>

      <div class="result-stats">
        ${statItems.map(item => `
          <div class="stat-item">
            <div class="stat-value">${item.value}</div>
            <div class="stat-label">${item.label}</div>
          </div>
        `).join('')}
      </div>

      ${validationHtml}

      ${downloadBtn}
    </div>
  `;

  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

/** 显示失败结果 */
function showResultError(message) {
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');

  resultContent.innerHTML = `
    <div class="result-error fade-in">
      <div class="result-icon-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h3 class="result-title">处理失败</h3>
      <div class="error-message">${escapeHtml(message)}</div>
    </div>
  `;

  resultSection.classList.remove('hidden');
}

/** 使用样例数据填充模板 — 一键生成报告 */
async function startSampleFill() {
  if (isProcessing) return;
  if (!templateSessionId || !cachedSampleData) {
    showToast('请先上传模板以生成样例数据', 'error');
    return;
  }

  isProcessing = true;

  // 更新步骤
  updateStep(3);
  const progressSection = document.getElementById('progressSection');
  progressSection.classList.remove('hidden');
  progressSection.classList.add('fade-in');
  document.getElementById('resultSection').classList.add('hidden');
  resetProgress();

  try {
    setProgress(1, '正在解析样例数据...');
    await delay(400);

    setProgress(2, '正在匹配模板锚点位置...');
    await delay(400);

    setProgress(3, '正在填写占位符和表格数据...');
    const result = await fillWithData(templateSessionId, cachedSampleData);

    setProgressComplete();
    updateStep(4);
    showResult(result.data);
  } catch (err) {
    setProgressError();
    showResultError(err.message);
    showToast('样例数据填充失败: ' + err.message, 'error');
  } finally {
    isProcessing = false;
  }
}

/** 重置全部 */
function resetAll() {
  if (isProcessing) return;

  templateFile = null;
  rjFile = null;
  mdFile = null;
  templateSessionId = null;
  rjSessionId = null;
  mdSessionId = null;
  rjAnalysis = null;
  mdAnalysis = null;

  document.getElementById('templateDropzone').classList.remove('hidden');
  document.getElementById('templateReady').classList.add('hidden');
  document.getElementById('rjDropzone').classList.remove('hidden');
  document.getElementById('rjReady').classList.add('hidden');
  document.getElementById('mdDropzone').classList.remove('hidden');
  document.getElementById('mdReady').classList.add('hidden');
  document.getElementById('templateInput').value = '';
  document.getElementById('rjInput').value = '';
  document.getElementById('mdInput').value = '';

  document.getElementById('previewSection').classList.add('hidden');
  document.getElementById('actionSection').classList.add('hidden');
  document.getElementById('progressSection').classList.add('hidden');
  document.getElementById('resultSection').classList.add('hidden');
  document.getElementById('rjBasicInfoSection').classList.add('hidden');
  document.getElementById('templateStructureSection').classList.add('hidden');

  updateStep(1);
}

/** 读取文件为文本 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/** 延迟 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 返回当前模板 sessionId（供下载按钮使用） */
function currentTemplateSessionId() {
  return templateSessionId || '';
}

/** 全局存储最近的样例数据（用于下载按钮） */
let cachedSampleData = null;

// ==================== 模板数据结构A 渲染 ====================

/**
 * 渲染模板数据结构A（基于 TemplateStructure 的纯数据层描述）
 * @param {Object} desc - 后端 /api/template/structure 返回的 desc 对象
 * @param {Object} [sampleData] - 可选的样例数据（UnifiedReportData），传入时用样例值填充显示
 */
function renderTemplateStructure(desc, sampleData) {
  const section = document.getElementById('templateStructureSection');
  const content = document.getElementById('tsContent');
  const meta = document.getElementById('tsMeta');
  const downloadBtn = document.getElementById('tsDownloadBtn');
  const sampleDownloadBtn = document.getElementById('tsSampleDownloadBtn');

  if (!desc || !desc.sections) {
    section.classList.add('hidden');
    return;
  }

  // 缓存样例数据
  cachedSampleData = sampleData || null;

  // 构建样例数据索引
  const sampleBasic = sampleData ? sampleData.basicInfo || {} : null;
  const sampleSections = sampleData ? sampleData.sections || [] : null;

  // 统计
  const kvSections = desc.sections.filter(s => s.tables.some(t => t.tableType === 'KeyValueTable'));
  const nestedKvSections = desc.sections.filter(s => s.tables.some(t => t.tableType === 'NestedKeyValueTable'));
  const listSections = desc.sections.filter(s => s.tables.some(t => t.tableType === 'DataTable'));
  const totalTables = desc.sections.reduce((sum, s) => sum + s.tables.length, 0);
  const sigSections = desc.sections.filter(s => s.tables.some(t => t.hasSignatureRow));

  const sampleText = sampleData ? '（已填充样例）' : '';
  meta.textContent = `${desc.sections.length} 个模板区域 · ${totalTables} 张表格 · ${desc.basicInfo.length} 个占位符字段 ${sampleText}`;

  let html = '';

  // —— BasicInfo 占位符字段 ——
  if (desc.basicInfo && desc.basicInfo.length > 0) {
    html += `<div class="ts-block">`;
    html += `<h4 class="ts-block-title"><span class="ts-block-icon">📝</span> 报告基本信息字段 (BasicInfo)</h4>`;
    html += `<div class="ts-field-grid">`;
    for (const f of desc.basicInfo) {
      const sampleVal = sampleBasic ? (sampleBasic[f.fieldName] || '') : '';
      html += `<div class="ts-field-item">
        <span class="ts-field-name">${esc(f.fieldName)}</span>
        <span class="ts-field-desc">${esc(f.description || '—')}</span>
        <code class="ts-field-pattern">${esc(f.placeholderPattern)}</code>
        ${sampleVal ? `<span class="ts-field-sample">${esc(sampleVal)}</span>` : ''}
      </div>`;
    }
    html += `</div></div>`;
  }

  // —— 模板表格区域（键值对 + 列表型） ——
  const tableSections = desc.sections.filter(s => s.sectionId !== '_placeholders');
  for (let si = 0; si < tableSections.length; si++) {
    const sec = tableSections[si];
    const secSample = sampleSections ? sampleSections[si] : null;
    const hasKv = sec.tables.some(t => t.tableType === 'KeyValueTable');
    const hasNestedKv = sec.tables.some(t => t.tableType === 'NestedKeyValueTable');
    const hasList = sec.tables.some(t => t.tableType === 'DataTable');
    const hasSig = sec.tables.some(t => t.hasSignatureRow);

    html += `<div class="ts-block">`;
    html += `<h4 class="ts-block-title">
      <span class="ts-block-icon">${hasNestedKv ? '🗂' : hasKv ? '🔑' : '📊'}</span>
      ${esc(sec.sectionTitle || '表格_' + (si + 1))}
    </h4>`;

    // 签名行标签展示
    if (sec.signatureRow && sec.signatureRow.hasSignature && sec.signatureRow.labels) {
      html += `<div class="ts-sig-labels"><span class="ts-sig-label-icon">✍</span>`;
      html += sec.signatureRow.labels.filter(l => l).map(l => `<span class="ts-sig-label-chip">${esc(l)}</span>`).join(' ');
      html += `</div>`;
    }

    for (const tbl of sec.tables) {
      if (tbl.tableType === 'HybridTable') {
        // 混合 KV+List 表：一个标签页展示 KV 区 + 列表区
        html += `<div class="ts-table-card ts-table-hybrid">
          <span class="ts-tag ts-tag-hybrid">混合表（KV + 列表）</span>
          <span class="ts-table-index">表格[${tbl.tableIndex}]</span>`;
        if (tbl.hasSignatureRow) {
          html += `<span class="ts-tag ts-tag-sig">含签名</span>`;
        }
        if (tbl.hybridListHeaderRows && tbl.hybridListHeaderRows > 1) {
          html += `<span class="ts-tag ts-tag-hint">${tbl.hybridListHeaderRows}层列表头</span>`;
        }

        // KV 键值对区
        html += `<div class="ts-hybrid-kv-section">
          <div class="ts-hybrid-label">🔑 键值对（首行）</div>
          <div class="ts-kv-list">`;
        if (tbl.expectedKeys && tbl.expectedKeys.length > 0) {
          const kvMap = {};
          if (secSample && secSample.kvPairs) {
            for (const kv of secSample.kvPairs) {
              const cleanKey = (kv.key || '').replace(/[：:]/g, '').trim();
              kvMap[cleanKey] = kv;
              kvMap[kv.key] = kv;
            }
          }
          for (const k of tbl.expectedKeys) {
            const cleanKey = k.replace(/[：:]/g, '').trim();
            const kv = kvMap[k] || kvMap[cleanKey];
            const sampleVal = kv ? kv.value : '';
            if (sampleVal) {
              html += `<div class="ts-kv-row ts-kv-filled"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-value">${esc(sampleVal)}</span></div>`;
            } else {
              html += `<div class="ts-kv-row"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-placeholder">待填入</span></div>`;
            }
          }
        } else {
          html += `<span class="ts-empty-hint">（自动检测键值对标签）</span>`;
        }
        html += `</div></div>`;

        // 列表区（与下面的 DataTable 分支一致）
        html += `<div class="ts-hybrid-list-section">
          <div class="ts-hybrid-label">📊 列表数据</div>
          <table class="ts-column-table"><thead><tr>`;
        const hCols = tbl.expectedColumns || [];
        if (hCols.length > 0) {
          for (const col of hCols) {
            html += `<th>${esc(col)}</th>`;
          }
        } else {
          html += `<th>（自动检测列名）</th>`;
        }
        html += `<th class="ts-col-hint">…</th>`;
        html += `</tr></thead><tbody>`;
        if (secSample && secSample.tables && secSample.tables.length > 0) {
          const sampleTbl = secSample.tables[0];
          const sampleRows = sampleTbl ? (sampleTbl.rows || []) : [];
          if (sampleRows.length > 0) {
            for (const row of sampleRows.slice(0, 2)) {
              html += `<tr>`;
              for (const col of hCols) {
                html += `<td class="ts-sample-cell">${esc(row[col] || '—')}</td>`;
              }
              html += `<td class="ts-col-hint">…</td></tr>`;
            }
          } else {
            html += `<tr>`;
            for (let i2 = 0; i2 < hCols.length; i2++) html += `<td>行数据</td>`;
            html += `<td class="ts-col-hint">…</td></tr>`;
          }
        } else {
          html += `<tr>`;
          for (let i2 = 0; i2 < hCols.length; i2++) html += `<td>行数据</td>`;
          html += `<td class="ts-col-hint">…</td></tr>`;
        }
        html += `</tbody></table></div>`;
        html += `</div>`;
      } else if (tbl.tableType === 'NestedKeyValueTable') {
        // 嵌套键值对表（含类别标题行）
        html += `<div class="ts-table-card ts-table-kv ts-table-nested">
          <span class="ts-tag ts-tag-nested">嵌套键值对表</span>
          <span class="ts-table-index">表格[${tbl.tableIndex}]</span>
          <span class="ts-tag ts-tag-hint">含类别标题行</span>`;
        html += `<div class="ts-kv-list">`;
        if (tbl.expectedKeys && tbl.expectedKeys.length > 0) {
          const kvMap = {};
          if (secSample && secSample.kvPairs) {
            for (const kv of secSample.kvPairs) {
              const cleanKey = (kv.key || '').replace(/[：:]/g, '').trim();
              kvMap[cleanKey] = kv;
              kvMap[kv.key] = kv;
            }
          }
          for (const k of tbl.expectedKeys) {
            const cleanKey = k.replace(/[：:]/g, '').trim();
            const kv = kvMap[k] || kvMap[cleanKey];
            const sampleVal = kv ? kv.value : '';
            if (sampleVal) {
              html += `<div class="ts-kv-row ts-kv-filled"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-value">${esc(sampleVal)}</span></div>`;
            } else {
              html += `<div class="ts-kv-row"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-placeholder">待填入</span></div>`;
            }
          }
        } else {
          html += `<span class="ts-empty-hint">（自动检测键值对标签）</span>`;
        }
        html += `</div></div>`;
      } else if (tbl.tableType === 'KeyValueTable') {
        // 键值对表
        html += `<div class="ts-table-card ts-table-kv">
          <span class="ts-tag ts-tag-kv">键值对表</span>
          <span class="ts-table-index">表格[${tbl.tableIndex}]</span>`;
        if (tbl.hasSignatureRow) {
          html += `<span class="ts-tag ts-tag-sig">含签名</span>`;
        }
        html += `<div class="ts-kv-list">`;
        if (tbl.expectedKeys && tbl.expectedKeys.length > 0) {
          // 构建 KV 查找 Map
          const kvMap = {};
          if (secSample && secSample.kvPairs) {
            for (const kv of secSample.kvPairs) {
              const cleanKey = (kv.key || '').replace(/[：:]/g, '').trim();
              kvMap[cleanKey] = kv;
              kvMap[kv.key] = kv;
            }
          }
          for (const k of tbl.expectedKeys) {
            const cleanKey = k.replace(/[：:]/g, '').trim();
            const kv = kvMap[k] || kvMap[cleanKey];
            const sampleVal = kv ? kv.value : '';
            if (sampleVal) {
              html += `<div class="ts-kv-row ts-kv-filled"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-value">${esc(sampleVal)}</span></div>`;
            } else {
              html += `<div class="ts-kv-row"><span class="ts-kv-key">${esc(k)}</span><span class="ts-kv-arrow">→</span><span class="ts-kv-placeholder">待填入</span></div>`;
            }
          }
        } else {
          html += `<span class="ts-empty-hint">（自动检测键值对标签）</span>`;
        }
        html += `</div></div>`;
      } else {
        // 列表型表格
        html += `<div class="ts-table-card ts-table-list">
          <span class="ts-tag ts-tag-list">列表型表格</span>
          <span class="ts-table-index">表格[${tbl.tableIndex}]</span>`;
        if (tbl.hasSignatureRow) {
          html += `<span class="ts-tag ts-tag-sig">含签名</span>`;
        }
        html += `<table class="ts-column-table"><thead><tr>`;
        const cols = tbl.expectedColumns || [];
        if (cols.length > 0) {
          for (const col of cols) {
            html += `<th>${esc(col)}</th>`;
          }
        } else {
          html += `<th>（自动检测列名）</th>`;
        }
        html += `<th class="ts-col-hint">…</th>`;
        html += `</tr></thead><tbody>`;
        // 如果有样例数据行，展示它们
        if (secSample && secSample.tables && secSample.tables.length > 0) {
          const sampleTbl = secSample.tables[0];
          const sampleRows = sampleTbl ? (sampleTbl.rows || []) : [];
          if (sampleRows.length > 0) {
            for (const row of sampleRows.slice(0, 2)) {
              html += `<tr>`;
              for (const col of cols) {
                html += `<td class="ts-sample-cell">${esc(row[col] || '—')}</td>`;
              }
              html += `<td class="ts-col-hint">…</td></tr>`;
            }
          } else {
            html += `<tr>`;
            for (let i = 0; i < cols.length; i++) html += `<td>行数据</td>`;
            html += `<td class="ts-col-hint">…</td></tr>`;
          }
        } else {
          html += `<tr>`;
          for (let i = 0; i < cols.length; i++) html += `<td>行数据</td>`;
          html += `<td class="ts-col-hint">…</td></tr>`;
        }
        html += `</tbody></table></div>`;
      }
    }

    // 签名样例数据展示
    if (hasSig && secSample && secSample.signature && secSample.signature.inspectorName) {
      const sig = secSample.signature;
      html += `<div class="ts-signature-sample">
        <span class="ts-sig-sample-icon">✍</span>
        <span class="ts-sig-sample-label">样例签名数据：</span>
        <span>检测人: <strong>${esc(sig.inspectorName)}</strong> ${esc(sig.inspectorDate)}</span>
        <span class="ts-sig-sample-divider">|</span>
        <span>校核人: <strong>${esc(sig.checkerName)}</strong> ${esc(sig.checkerDate)}</span>
        <span class="ts-sig-sample-divider">|</span>
        <span>审定人: <strong>${esc(sig.reviewerName)}</strong> ${esc(sig.reviewerDate)}</span>
      </div>`;
    }

    html += `</div>`;
  }

  if (tableSections.length === 0 && (!desc.basicInfo || desc.basicInfo.length === 0)) {
    html += `<div class="ts-empty"><p>模板中未检测到表格或占位符字段</p></div>`;
  }

  content.innerHTML = html;
  section.classList.remove('hidden');

  // 启用下载按钮
  if (downloadBtn) {
    downloadBtn.disabled = false;
    downloadBtn.title = '下载模板数据结构为 JSON';
  }
  if (sampleDownloadBtn) {
    sampleDownloadBtn.disabled = !sampleData;
    sampleDownloadBtn.title = sampleData ? '下载含样例数据的填充 JSON' : '请先上传模板以生成样例数据';
  }
  // 启用/禁用样例填充按钮
  const sampleFillBtn = document.getElementById('tsSampleFillBtn');
  if (sampleFillBtn) {
    sampleFillBtn.disabled = !sampleData;
    sampleFillBtn.title = sampleData ? '一键将样例数据填入模板并生成报告' : '请先上传模板以生成样例数据';
  }
}

/** HTML 转义 */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
