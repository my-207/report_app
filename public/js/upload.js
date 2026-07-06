/**
 * 上传模块 — 三卡片双源模式
 * 卡片1: 模板 .docx | 卡片2: .rj 知识图谱 | 卡片3: 原始MD.docx
 */

// 全局状态
let templateFile = null;
let templateSessionId = null;
let rjFile = null;
let rjSessionId = null;
let rjAnalysis = null;
let mdFile = null;
let mdSessionId = null;
let mdAnalysis = null;

/** 初始化上传功能 */
function initUpload() {
  const templateDropzone = document.getElementById('templateDropzone');
  const templateInput = document.getElementById('templateInput');
  const rjDropzone = document.getElementById('rjDropzone');
  const rjInput = document.getElementById('rjInput');
  const mdDropzone = document.getElementById('mdDropzone');
  const mdInput = document.getElementById('mdInput');

  // 模板上传
  templateDropzone.addEventListener('click', () => templateInput.click());
  templateInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleTemplateFile(e.target.files[0]);
  });
  setupDragDrop(templateDropzone, handleTemplateFile, '.docx');

  // .rj 知识图谱上传
  rjDropzone.addEventListener('click', () => rjInput.click());
  rjInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleRjUpload(e.target.files[0]);
  });
  setupDragDrop(rjDropzone, handleRjUpload, '.rj');

  // 原始MD.docx上传
  mdDropzone.addEventListener('click', () => mdInput.click());
  mdInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleMdUpload(e.target.files[0]);
  });
  setupDragDrop(mdDropzone, handleMdUpload, '.docx');
}

/** 设置拖拽上传 */
function setupDragDrop(element, handler, ...allowedExts) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.add('drag-over');
  });

  element.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (allowedExts.includes(ext)) {
        handler(file);
      } else {
        showToast(`不支持的文件格式: ${ext}`, 'error');
      }
    }
  });
}

/** 处理模板文件上传 */
async function handleTemplateFile(file) {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    showToast('请上传 .docx 格式的 Word 模板文件', 'error');
    return;
  }

  try {
    showToast('正在解析模板...', 'info');
    const result = await uploadTemplate(file);
    templateFile = file;
    templateSessionId = result.data.sessionId;

    document.getElementById('templateDropzone').classList.add('hidden');
    document.getElementById('templateReady').classList.remove('hidden');
    document.getElementById('templateFileName').textContent = file.name;
    document.getElementById('templateFileSize').textContent = formatFileSize(file.size);

    showToast('模板上传成功', 'success');
    checkAllReady();

    // 自动分析模板数据结构A
    try {
      const structResult = await getTemplateStructure(templateSessionId);
      // 同时获取样例数据
      let sampleData = null;
      try {
        const sampleResult = await getTemplateSampleData(templateSessionId);
        sampleData = sampleResult.data;
      } catch (e) {
        console.warn('样例数据获取失败（非致命）:', e.message);
      }
      renderTemplateStructure(structResult.data, sampleData);
    } catch (e) {
      console.warn('模板结构分析失败（非致命）:', e.message);
    }
  } catch (err) {
    showToast('模板上传失败: ' + err.message, 'error');
  }
}

/** 处理 .rj 知识图谱文件上传 */
async function handleRjUpload(file) {
  if (!file.name.toLowerCase().endsWith('.rj')) {
    showToast('请上传 .rj 格式的知识图谱文件', 'error');
    return;
  }

  try {
    showToast('正在解析知识图谱...', 'info');
    const basicInfo = collectBasicInfo();
    const result = await uploadRj(file, basicInfo);
    rjFile = file;
    rjSessionId = result.data.sessionId;
    rjAnalysis = result.data.analysis;

    document.getElementById('rjDropzone').classList.add('hidden');
    document.getElementById('rjReady').classList.remove('hidden');
    document.getElementById('rjFileName').textContent = file.name;
    document.getElementById('rjFileSize').textContent = formatFileSize(file.size);

    showToast('知识图谱解析成功', 'success');

    // 渲染预览（优先 Unified）
    if (result.data.analysis.unified || result.data.unified) {
      renderUnifiedPreview(result.data.analysis.unified || result.data.unified);
    } else {
      renderPreview(rjAnalysis);
    }
    document.getElementById('rjBasicInfoSection').classList.remove('hidden');
    if (rjAnalysis.basicInfo && rjAnalysis.basicInfo.deviceName) {
      document.getElementById('rjDeviceName').value = rjAnalysis.basicInfo.deviceName;
    }
    checkAllReady();
  } catch (err) {
    showToast('知识图谱解析失败: ' + err.message, 'error');
  }
}

/** 处理原始MD.docx上传 */
async function handleMdUpload(file) {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    showToast('请上传 .docx 格式的原始报告文件', 'error');
    return;
  }

  try {
    showToast('正在解析原始报告...', 'info');
    const result = await uploadSource(file);
    mdFile = file;
    mdSessionId = result.data.sessionId;
    mdAnalysis = result.data.analysis;

    document.getElementById('mdDropzone').classList.add('hidden');
    document.getElementById('mdReady').classList.remove('hidden');
    document.getElementById('mdFileName').textContent = file.name;
    document.getElementById('mdFileSize').textContent = formatFileSize(file.size);

    showToast('原始报告解析成功', 'success');

    // 如果还没有预览（没有 .rj），用 MD 渲染预览
    if (!rjAnalysis) {
      if (mdAnalysis.sections) {
        renderUnifiedPreview(mdAnalysis);
      } else {
        renderPreview(mdAnalysis);
      }
      document.getElementById('rjBasicInfoSection').classList.add('hidden');
    }
    checkAllReady();
  } catch (err) {
    showToast('原始报告解析失败: ' + err.message, 'error');
  }
}

/** 收集 BasicInfo 补充表单数据 */
function collectBasicInfo() {
  const fields = ['reportNumber', 'companyName', 'deviceName', 'reportTypePrefix',
    'inspectionStartDate', 'inspectionEndDate', 'inspectorDate', 'checkerDate', 'reviewerDate'];
  const basicInfo = {};
  for (const f of fields) {
    const el = document.getElementById('rj' + f.charAt(0).toUpperCase() + f.slice(1));
    if (el && el.value.trim()) {
      basicInfo[f] = el.value.trim();
    }
  }
  return Object.keys(basicInfo).length > 0 ? basicInfo : undefined;
}

/** 应用补充信息（重新解析 .rj） */
async function applyBasicInfo() {
  if (!rjFile) return;
  showToast('正在更新补充信息...', 'info');
  try {
    const basicInfo = collectBasicInfo();
    const result = await uploadRj(rjFile, basicInfo);
    rjSessionId = result.data.sessionId;
    rjAnalysis = result.data.analysis;
    renderPreview(rjAnalysis);
    showToast('补充信息已更新', 'success');
  } catch (err) {
    showToast('更新失败: ' + err.message, 'error');
  }
}

/** 折叠/展开 BasicInfo 表单 */
function toggleRjForm() {
  const body = document.getElementById('rjFormBody');
  const toggle = document.getElementById('rjFormToggle');
  body.classList.toggle('hidden');
  toggle.classList.toggle('collapsed');
}

/** 移除模板 */
function removeTemplate() {
  templateFile = null;
  templateSessionId = null;
  document.getElementById('templateDropzone').classList.remove('hidden');
  document.getElementById('templateReady').classList.add('hidden');
  document.getElementById('templateInput').value = '';
  checkAllReady();
}

/** 移除 .rj */
function removeRj() {
  rjFile = null;
  rjSessionId = null;
  rjAnalysis = null;
  document.getElementById('rjDropzone').classList.remove('hidden');
  document.getElementById('rjReady').classList.add('hidden');
  document.getElementById('rjInput').value = '';
  document.getElementById('rjBasicInfoSection').classList.add('hidden');
  // 如果还有MD分析，用它渲染预览
  if (mdAnalysis) {
    if (mdAnalysis.sections) {
      renderUnifiedPreview(mdAnalysis);
    } else {
      renderPreview(mdAnalysis);
    }
  } else {
    document.getElementById('previewSection').classList.add('hidden');
  }
  checkAllReady();
}

/** 移除原始MD */
function removeMd() {
  mdFile = null;
  mdSessionId = null;
  mdAnalysis = null;
  document.getElementById('mdDropzone').classList.remove('hidden');
  document.getElementById('mdReady').classList.add('hidden');
  document.getElementById('mdInput').value = '';
  if (!rjAnalysis) {
    document.getElementById('previewSection').classList.add('hidden');
  }
  checkAllReady();
}

/** 检查是否至少有一个源已就绪 */
function checkAllReady() {
  const actionSection = document.getElementById('actionSection');
  const hasSource = rjFile || mdFile;
  if (templateFile && hasSource) {
    actionSection.classList.remove('hidden');
    updateStep(2);
  } else {
    actionSection.classList.add('hidden');
    if (!templateFile && !hasSource) updateStep(1);
  }
}

/** Toast 提示 */
function showToast(message, type = 'info') {
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  const colors = {
    info: { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
    success: { bg: '#ECFDF5', color: '#10B981', border: '#A7F3D0' },
    error: { bg: '#FEF2F2', color: '#EF4444', border: '#FECACA' },
  };

  const c = colors[type] || colors.info;
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${c.bg};
    color: ${c.color};
    border: 1px solid ${c.border};
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    animation: fadeInUp 0.3s ease;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
