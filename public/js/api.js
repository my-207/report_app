/**
 * API 调用模块 — 封装 fetch 请求、统一错误处理
 */

const API_BASE = '/api';

/** 通用 fetch 封装 */
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      ...options,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || `请求失败 (${response.status})`);
    }

    return data;
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      throw new Error('无法连接到服务器，请确认后端服务已启动');
    }
    throw err;
  }
}

/** 上传模板文件 */
async function uploadTemplate(file) {
  const formData = new FormData();
  formData.append('template', file);

  return apiCall(`${API_BASE}/upload-template`, {
    method: 'POST',
    body: formData,
  });
}

/** 使用样例数据填充模板（直接传入 UnifiedReportData JSON） */
async function fillWithData(templateSessionId, unifiedData) {
  return apiCall(`${API_BASE}/fill-with-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateSessionId, unifiedData }),
  });
}

/** 下载生成报告 */
function downloadReport(fileName) {
  const link = document.createElement('a');
  link.href = `${API_BASE}/download/${fileName}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 获取文件大小显示文本 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
