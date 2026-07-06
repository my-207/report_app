/**
 * 预览模块 — 渲染 UnifiedReportData（统一数据结构A）
 * 展示：基本信息 + 每章节键值对表 + 列表型表格（全行）+ 签名面板
 */

/** 每个表格的折叠阈值 */
const COLLAPSE_THRESHOLD = 10;
/** 已展开的表格 ID 集合 */
let expandedTables = {};

/** 渲染 UnifiedReportData（新统一数据结构） */
function renderUnifiedPreview(unifiedData) {
  const previewSection = document.getElementById('previewSection');
  const actionSection = document.getElementById('actionSection');
  
  if (!unifiedData || !unifiedData.sections || unifiedData.sections.length === 0) {
    previewSection.classList.add('hidden');
    actionSection.classList.add('hidden');
    return;
  }

  renderBasicInfo(unifiedData.basicInfo);
  renderSections(unifiedData.sections);
  
  previewSection.classList.remove('hidden');
  previewSection.classList.add('fade-in');
  expandedTables = {};
  actionSection.classList.remove('hidden');
  updateStep(2);
}

/** 兼容旧版渲染 */
function renderPreview(analysis) {
  // 如果是 UnifiedReportData 格式（有 sections），走新渲染
  if (analysis && analysis.sections) {
    return renderUnifiedPreview(analysis);
  }
  // 旧版兼容：有 basicInfo 和 tablePreviews
  const basic = analysis.basicInfo || {};
  const fields = [
    ['报告编号', basic.reportNumber || '—'],
    ['单位名称', basic.companyName || '—'],
    ['设备名称', basic.deviceName || '—'],
    ['报告类型', basic.reportTypePrefix || '—'],
    ['检验起始', basic.inspectionStartDate || '—'],
    ['检验结束', basic.inspectionEndDate || '—'],
    ['检测人日期', basic.inspectorDate || '—'],
    ['校对人日期', basic.checkerDate || '—'],
    ['审核人日期', basic.reviewerDate || '—'],
  ];
  document.getElementById('previewBasic').innerHTML = fields.map(([l, v]) => 
    `<div class="info-row"><span class="label">${l}</span><span class="value">${escapeHtml(v)}</span></div>`
  ).join('');

  const tablePreviews = analysis.tablePreviews || [];
  const chapters = analysis.chapters || [];
  document.getElementById('previewTables').innerHTML = buildLegacyPreview(chapters, tablePreviews, analysis);
  
  document.getElementById('previewSection').classList.remove('hidden');
  document.getElementById('previewSection').classList.add('fade-in');
  expandedTables = {};
}

/** 渲染基本信息 */
function renderBasicInfo(basicInfo) {
  const info = basicInfo || {};
  const fields = [
    ['报告编号', info.reportNumber || '—'],
    ['单位名称', info.companyName || '—'],
    ['设备名称', info.deviceName || '—'],
    ['报告类型', info.reportTypePrefix || '—'],
    ['检验起始', info.inspectionStartDate || '—'],
    ['检验结束', info.inspectionEndDate || '—'],
    ['检测人日期', info.inspectorDate || '—'],
    ['校对人日期', info.checkerDate || '—'],
    ['审核人日期', info.reviewerDate || '—'],
  ];
  document.getElementById('previewBasic').innerHTML = fields.map(([l, v]) =>
    `<div class="info-row"><span class="label">${l}</span><span class="value">${escapeHtml(v)}</span></div>`
  ).join('');
}

/** 渲染所有章节 */
function renderSections(sections) {
  const totalTables = sections.reduce((s, sec) => s + sec.tables.length, 0);
  const totalKv = sections.reduce((s, sec) => s + sec.kvPairs.length, 0);

  let html = `<div class="table-overview">`;
  
  // 统计芯片
  html += `<div class="overview-summary">
    <div class="summary-chip"><span class="summary-value">${sections.length}</span><span class="summary-label">章节</span></div>
    <div class="summary-chip"><span class="summary-value">${totalTables}</span><span class="summary-label">表格</span></div>
    <div class="summary-chip"><span class="summary-value">${totalKv}</span><span class="summary-label">键值对</span></div>
  </div>`;

  // 章节列表
  html += `<div class="chapter-list">`;
  sections.slice(0, 12).forEach(s => {
    html += `<div class="chapter-chip">
      <div class="chapter-chip-name">${escapeHtml(s.title || `章节 ${s.id}`)}</div>
      <div class="chapter-chip-meta">${s.tables.length}表 · ${s.kvPairs.length}键值对</div>
    </div>`;
  });
  if (sections.length > 12) html += `<div class="chapter-chip-more">... 还有 ${sections.length - 12} 个章节</div>`;
  html += `</div>`;

  // 每个章节的详细预览
  html += `<div class="table-detail-list">`;
  sections.forEach((section, sidx) => {
    html += buildSectionCard(section, sidx);
  });
  html += `</div></div>`;

  document.getElementById('previewTables').innerHTML = html;
}

/** 构建章节预览卡片 */
function buildSectionCard(section, sidx) {
  let html = `<div class="section-preview-card">
    <div class="section-preview-header">
      <span class="section-badge">${escapeHtml(section.id)}</span>
      <span class="section-title">${escapeHtml(section.title)}</span>
      <span class="section-meta">${section.tables.length}表格 · ${section.kvPairs.length}键值对${section.hasNestedKvTable ? ' · <span class="nested-badge">嵌套KV</span>' : ''}${section.hasHybridTable ? ' · <span class="hybrid-badge">混合表</span>' : ''}</span>
    </div>`;

  // 键值对表
  if (section.kvPairs && section.kvPairs.length > 0) {
    html += `<div class="kv-preview-table">
      <table>
        <thead><tr><th>标签</th><th>值</th></tr></thead>
        <tbody>`;
    section.kvPairs.forEach(kv => {
      html += `<tr><td class="kv-key">${escapeHtml(kv.key)}</td><td class="kv-value">${escapeHtml(kv.value || '(空)')}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // 列表型表格
  section.tables.forEach((dt, tidx) => {
    const tableId = `table-sec${sidx}-t${tidx}`;
    const shouldCollapse = dt.rows.length > COLLAPSE_THRESHOLD;
    const visibleRows = shouldCollapse ? dt.rows.slice(0, COLLAPSE_THRESHOLD) : dt.rows;

    html += `<div class="table-detail-card" id="${tableId}">
      <div class="table-detail-header">
        <span class="table-type-badge">${escapeHtml(dt.tableType)}</span>
        <span class="table-row-count">${dt.rows.length} 行</span>
      </div>
      <div class="table-mini">
        <table>
          <thead><tr>${dt.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>`;
    visibleRows.forEach(row => {
      html += `<tr>${dt.headers.map(h => `<td>${row[h] ? escapeHtml(row[h]) : '<span class="empty-cell">(空)</span>'}</td>`).join('')}</tr>`;
    });
    html += `</tbody>`;

    if (shouldCollapse) {
      html += `<tbody id="${tableId}-hidden" style="display:none">`;
      dt.rows.slice(COLLAPSE_THRESHOLD).forEach(row => {
        html += `<tr>${dt.headers.map(h => `<td>${row[h] ? escapeHtml(row[h]) : '<span class="empty-cell">(空)</span>'}</td>`).join('')}</tr>`;
      });
      html += `</tbody>`;
    }
    html += `</table>`;

    if (shouldCollapse) {
      html += `<div class="table-toggle-row">
        <button class="btn-table-toggle" onclick="toggleTableRows('${tableId}', ${dt.rows.length - COLLAPSE_THRESHOLD})">
          <span class="toggle-icon">▼</span>
          <span class="toggle-text">展开全部 ${dt.rows.length} 行</span>
        </button>
      </div>`;
    }
    html += `</div></div>`;
  });

  // 签名数据
  if (section.signature) {
    const sig = section.signature;
    if (sig.inspectorName || sig.checkerName || sig.reviewerName) {
      html += `<div class="signature-preview">
        <div class="sig-item"><span class="sig-role">检测：</span><span class="sig-name">${escapeHtml(sig.inspectorName || '—')}</span><span class="sig-date">${escapeHtml(sig.inspectorDate || '')}</span></div>
        <div class="sig-item"><span class="sig-role">校对：</span><span class="sig-name">${escapeHtml(sig.checkerName || '—')}</span><span class="sig-date">${escapeHtml(sig.checkerDate || '')}</span></div>
        <div class="sig-item"><span class="sig-role">审核：</span><span class="sig-name">${escapeHtml(sig.reviewerName || '—')}</span><span class="sig-date">${escapeHtml(sig.reviewerDate || '')}</span></div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
}

/** 旧版预览（兼容） */
function buildLegacyPreview(chapters, tablePreviews, analysis) {
  let html = `<div class="table-overview">
    <div class="overview-summary">
      <div class="summary-chip"><span class="summary-value">${analysis.totalChapters || chapters.length}</span><span class="summary-label">章节</span></div>
      <div class="summary-chip"><span class="summary-value">${analysis.totalTables || 0}</span><span class="summary-label">表格</span></div>
    </div>
    <div class="chapter-list">${chapters.slice(0,12).map(ch => 
      `<div class="chapter-chip"><div class="chapter-chip-name">${escapeHtml(ch.title||ch.id)}</div><div class="chapter-chip-meta">编号: ${escapeHtml(ch.id)}</div></div>`
    ).join('')}</div>`;
  
  if (tablePreviews && tablePreviews.length > 0) {
    html += `<div class="table-detail-list">${tablePreviews.map((tp, idx) => buildTableCard(tp, idx)).join('')}</div>`;
  }
  html += `</div>`;
  return html;
}

function buildTableCard(tp, idx) {
  const tableId = `table-preview-${idx}`;
  const shouldCollapse = tp.rowCount > COLLAPSE_THRESHOLD;
  const visibleRows = shouldCollapse ? tp.sampleRows.slice(0, COLLAPSE_THRESHOLD) : tp.sampleRows;
  return `<div class="table-detail-card" id="${tableId}">
      <div class="table-detail-header">
        <span class="table-section-badge">${escapeHtml(tp.sectionId)}</span>
        <span class="table-type-badge">${escapeHtml(tp.entityType)}</span>
        <span class="table-row-count">${tp.rowCount} 行</span>
      </div>
      <div class="table-mini"><table><thead><tr>${tp.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${visibleRows.map(row => `<tr>${row.map(c => `<td>${c ? escapeHtml(c) : '<span class="empty-cell">(空)</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
        ${shouldCollapse ? `<tbody id="${tableId}-hidden" style="display:none">${tp.sampleRows.slice(COLLAPSE_THRESHOLD).map(row => `<tr>${row.map(c => `<td>${c ? escapeHtml(c) : '<span class="empty-cell">(空)</span>'}</td>`).join('')}</tr>`).join('')}</tbody>` : ''}
      </table>
      ${shouldCollapse ? `<div class="table-toggle-row"><button class="btn-table-toggle" onclick="toggleTableRows('${tableId}', ${tp.rowCount - COLLAPSE_THRESHOLD})"><span class="toggle-icon">▼</span><span class="toggle-text">展开全部 ${tp.rowCount} 行</span></button></div>` : ''}
      </div></div>`;
}

function toggleTableRows(tableId, totalCount) {
  const hiddenBody = document.getElementById(tableId + '-hidden');
  const card = document.getElementById(tableId);
  if (!card || !hiddenBody) return;
  const btn = card.querySelector('.btn-table-toggle');
  const icon = btn ? btn.querySelector('.toggle-icon') : null;
  const text = btn ? btn.querySelector('.toggle-text') : null;
  if (hiddenBody.style.display === 'none') {
    hiddenBody.style.display = '';
    if (icon) icon.textContent = '▲';
    if (text) text.textContent = '收起';
  } else {
    hiddenBody.style.display = 'none';
    if (icon) icon.textContent = '▼';
    if (text) text.textContent = `展开全部 ${totalCount + COLLAPSE_THRESHOLD} 行`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}
