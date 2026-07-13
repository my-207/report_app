/**
 * 上传模块 — 模板 + 实采JSON
 */

// 全局状态
let templateFile = null;
let templateSessionId = null;

/** 初始化上传功能 */
function initUpload() {
  const templateDropzone = document.getElementById('templateDropzone');
  const templateInput = document.getElementById('templateInput');

  // 模板上传
  templateDropzone.addEventListener('click', () => templateInput.click());
  templateInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleTemplateFile(e.target.files[0]);
  });
  setupDragDrop(templateDropzone, handleTemplateFile, '.docx');

  // 实采JSON上传
  const realDataInput = document.getElementById('realDataInput');
  if (realDataInput) {
    realDataInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleRealJsonUpload(e.target.files[0]);
    });
  }
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

    // 显示实采数据操作区
    document.getElementById('templateStructureSection').classList.remove('hidden');
    const realUploadBtn = document.getElementById('tsRealDataUploadBtn');
    if (realUploadBtn) { realUploadBtn.disabled = false; }
  } catch (err) {
    showToast('模板上传失败: ' + err.message, 'error');
  }
}

/** 移除模板 */
function removeTemplate() {
  templateFile = null;
  templateSessionId = null;
  document.getElementById('templateDropzone').classList.remove('hidden');
  document.getElementById('templateReady').classList.add('hidden');
  document.getElementById('templateInput').value = '';
  document.getElementById('templateStructureSection').classList.add('hidden');
  checkAllReady();
}

/** 检查模板是否已就绪 */
function checkAllReady() {
  const actionSection = document.getElementById('actionSection');
  if (templateFile) {
    actionSection.classList.remove('hidden');
    updateStep(2);
  } else {
    actionSection.classList.add('hidden');
    updateStep(1);
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

/** 处理实采JSON文件上传 */
function handleRealJsonUpload(file) {
  if (!file.name.toLowerCase().endsWith('.json')) {
    showToast('请上传 .json 格式的实采数据文件', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);

      // 校验 UnifiedReportData 格式
      const err = validateUnifiedData(data);
      if (err) {
        showToast('数据格式错误: ' + err, 'error');
        return;
      }

      // 缓存数据
      cachedRealData = data;
      cachedRealFileName = file.name;

      // 渲染预览
      renderUnifiedPreview(data);
      document.getElementById('previewSection').classList.remove('hidden');

      // 启用实采填充按钮
      const realFillBtn = document.getElementById('tsRealFillBtn');
      if (realFillBtn) { realFillBtn.disabled = false; realFillBtn.title = '将实际数据填入模板并生成报告'; }

      // 更新上传按钮状态
      const uploadBtn = document.getElementById('tsRealDataUploadBtn');
      if (uploadBtn) {
        uploadBtn.textContent = '\u2713 ' + file.name;
        uploadBtn.classList.add('btn-uploaded');
      }

      showToast('实采数据加载成功: ' + (data.sections ? data.sections.length + ' 个章节' : ''), 'success');
    } catch (err) {
      showToast('JSON 解析失败: ' + err.message, 'error');
    }
  };
  reader.onerror = function() {
    showToast('文件读取失败', 'error');
  };
  reader.readAsText(file);
}
