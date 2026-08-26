// 🟢 วางไว้ที่บรรทัดบนสุดของไฟล์ js/app.js
const API_URL = 'https://script.google.com/macros/s/AKfycbx8AQznXGrx9BGbCln6r3m9dsU7yF2w6vSCt8vMgoi7fHvR7icflL7GOCA-U8X5HmIG/exec'; // ⚠️ แทนที่ด้วย URL Web App ของคุณ

let map = null, markersLayer = null, allData = [], markerDict = {};
let isOfficer = false, isTechnician = false, isAdmin = false, currentDepartment = "";
let currentActiveId = "", currentActiveItemRaw = null, bmaMaskLayer = null, bmaDistrictsLayer = null, bmaCachedGeoJSON = null;
let successListGlobal = [], successListRaw = [], currentPage = 1, recordsPerPage = 25;
let estimateListRaw = [];
let masterFilteredList = [], currentMasterPage = 1, masterRecordsPerPage = 25;
let masterDisplayList = []; 
let globalReportCounts = {};
let currentUserCode = "";
let indexRawData = [], indexFilteredData = [], indexHeaders = [];
let compressedImageMap = {};

document.addEventListener("DOMContentLoaded", function () {
  initMap();
  loadMarkers();
  loadIndexData();
});

// 🛠️ 1. แก้ไข apiGet เพื่อป้องกันปัญหา 404 URL Parameters
async function apiGet(action, params = {}) {
  try {
    const queryParams = new URLSearchParams({ action, ...params }).toString();
    const sep = API_URL.includes('?') ? '&' : '?';
    const response = await fetch(`${API_URL}${sep}${queryParams}`, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn("apiGet Fallback:", err);
    return null;
  }
}

// 🛠️ 2. ปรับปรุงการโหลดประวัติไทม์ไลน์ (มีระบบ Fallback ป้องกันแสดงหน้าข้อผิดพลาด)
async function loadRepairHistoryTimeline(assetId) {
  const container = document.getElementById('repairTimelineContainer');
  if (!container) return;

  container.innerHTML = `<div class="p-6 text-center text-slate-400 font-medium">⏳ กำลังโหลดประวัติ...</div>`;

  let historyData = [];
  try {
    const res = await apiGet('getRepairHistory');
    if (res && res.success && Array.isArray(res.data)) {
      historyData = res.data;
    } else if (window.allRepairHistoryData) {
      historyData = window.allRepairHistoryData;
    }
  } catch (e) {
    if (window.allRepairHistoryData) historyData = window.allRepairHistoryData;
  }

  const filtered = historyData.filter(h => h && String(h.assetId).trim().toUpperCase() === String(assetId).trim().toUpperCase());

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400">
        <i class="ph ph-clock-counter-clockwise text-3xl mb-1 block"></i>
        ยังไม่มีประวัติการแจ้งซ่อมในระบบ
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(h => {
    const statusColor = h.status === 'ซ่อมเสร็จสิ้น' ? 'bg-emerald-100 text-emerald-700' : (h.status === 'รอจัดจ้าง' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700');
    return `
      <div class="p-3 mb-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
        <div class="flex justify-between items-center mb-1">
          <span class="font-bold text-slate-700">${h.date || '-'} (${h.repairId || '-'})</span>
          <span class="px-2 py-0.5 rounded font-bold text-[10px] ${statusColor}">${h.status}</span>
        </div>
        <div class="text-slate-600 mb-1"><b>อาการ/บันทึก:</b> ${h.details || '-'}</div>
        <div class="text-slate-400 text-[11px]">👤 ${h.reporter || '-'}</div>
      </div>`;
  }).join('');
}

// 🛠️ 3. เรนเดอร์ส่วนแสดงและบันทึกข้อมูลทางเทคนิค (เฉพาะ Admin & Technician)
function renderTechSpecsSection(item) {
  const container = document.getElementById('wsTechSpecsContainer');
  if (!container) return;

  // 🔒 ตรวจสอบสิทธิ์ผู้ใช้งาน (Admin & Technician)
  const role = window.userRole || sessionStorage.getItem('userRole') || localStorage.getItem('userRole') || '';
  const isAuthorized = (typeof isAdmin !== 'undefined' && isAdmin) ||
                       (typeof isTechnician !== 'undefined' && isTechnician) ||
                       (role === 'admin' || role === 'technician');

  if (!isAuthorized) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  // ดึงข้อมูลเทคนิคเฉพาะ
  const cBox = item['ตู้ควบคุม_เบรกเกอร์'] || item['ตู้ควบคุม/เบรกเกอร์'] || item.controlBox || '';
  const lType = item['หลอดไฟที่ติดตั้ง'] || item.lampType || '';
  const wSize = item['ขนาดสายไฟ'] || item.wireSize || '';
  const eTech = item['ข้อมูลเทคนิคอื่นๆ'] || item['อื่นๆ'] || item.extraTech || '';

  const safeCBox = String(cBox).replace(/"/g, '&quot;');
  const safeLType = String(lType).replace(/"/g, '&quot;');
  const safeWSize = String(wSize).replace(/"/g, '&quot;');
  const safeETech = String(eTech).replace(/"/g, '&quot;');

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="mt-3 p-3 bg-sky-50/80 border border-sky-200 rounded-xl text-xs shadow-xs">
      <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-sky-200/80">
        <span class="font-bold text-sky-900 flex items-center gap-1">
          ⚡ ข้อมูลเทคนิคเฉพาะ (สิทธิ์ Admin & Technician)
        </span>
        <button type="button" onclick="toggleTechEditForm('${item.ID}')" class="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg text-[11px] transition shadow-xs cursor-pointer">
          ✏️ บันทึก/แก้ไขข้อมูลเทคนิค
        </button>
      </div>

      <!-- 🟢 แสดงข้อมูลในหน้าต่างรายละเอียด: บรรทัดแรกเป็นหัวข้อ บรรทัดที่ 2 เป็นข้อมูล -->
      <div id="techDisplayView_${item.ID}" class="grid grid-cols-2 gap-x-3 gap-y-2.5 text-slate-700">
        <div class="bg-white/60 p-1.5 rounded-lg border border-sky-100">
          <span class="block text-slate-500 font-semibold text-[11px]">🗄️ ตู้ควบคุม / เบรกเกอร์</span>
          <span class="block text-slate-900 font-bold text-xs mt-0.5 break-words">${cBox || '<i class="text-slate-400 font-normal">ยังไม่ระบุ</i>'}</span>
        </div>
        <div class="bg-white/60 p-1.5 rounded-lg border border-sky-100">
          <span class="block text-slate-500 font-semibold text-[11px]">💡 หลอดไฟที่ติดตั้ง</span>
          <span class="block text-slate-900 font-bold text-xs mt-0.5 break-words">${lType || '<i class="text-slate-400 font-normal">ยังไม่ระบุ</i>'}</span>
        </div>
        <div class="bg-white/60 p-1.5 rounded-lg border border-sky-100">
          <span class="block text-slate-500 font-semibold text-[11px]">🔌 ขนาดสายไฟ</span>
          <span class="block text-slate-900 font-bold text-xs mt-0.5 break-words">${wSize || '<i class="text-slate-400 font-normal">ยังไม่ระบุ</i>'}</span>
        </div>
        <div class="bg-white/60 p-1.5 rounded-lg border border-sky-100">
          <span class="block text-slate-500 font-semibold text-[11px]">📝 อื่นๆ ระบุ</span>
          <span class="block text-slate-900 font-bold text-xs mt-0.5 break-words">${eTech || '<i class="text-slate-400 font-normal">ยังไม่ระบุ</i>'}</span>
        </div>
      </div>

      <!-- ฟอร์มแก้ไขข้อมูลเทคนิค -->
      <form id="techEditForm_${item.ID}" class="hidden space-y-2.5 mt-2 pt-2 border-t border-sky-200/80" onsubmit="submitTechSpecs(event, '${item.ID}')">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">ตู้ควบคุม / เบรกเกอร์</label>
            <input type="text" id="inputControlBox_${item.ID}" value="${safeCBox}" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-sky-500 bg-white" placeholder="เช่น 30A 2P Cutout">
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">หลอดไฟที่ติดตั้ง</label>
            <input type="text" id="inputLampType_${item.ID}" value="${safeLType}" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-sky-500 bg-white" placeholder="เช่น LED Highbay 150W">
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">ขนาดสายไฟ</label>
            <input type="text" id="inputWireSize_${item.ID}" value="${safeWSize}" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-sky-500 bg-white" placeholder="เช่น NYY 2x2.5 sq.mm">
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">อื่นๆ ระบุ</label>
            <input type="text" id="inputExtraTech_${item.ID}" value="${safeETech}" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-sky-500 bg-white" placeholder="ระบุเพิ่มเติม...">
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" onclick="toggleTechEditForm('${item.ID}')" class="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-medium cursor-pointer">ยกเลิก</button>
          <button type="submit" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-xs shadow-xs cursor-pointer">💾 บันทึกข้อมูลเทคนิค</button>
        </div>
      </form>
    </div>
  `;
}

// 🛠️ 4. ฟังก์ชันเปิด/ปิดฟอร์มแก้ไขข้อมูลเทคนิค
function toggleTechEditForm(id) {
  const displayView = document.getElementById(`techDisplayView_${id}`);
  const editForm = document.getElementById(`techEditForm_${id}`);
  if (displayView && editForm) {
    displayView.classList.toggle('hidden');
    editForm.classList.toggle('hidden');
  }
}

// 🛠️ 5. ส่งข้อมูลบันทึกลง Google Sheet พร้อมอัปเดตหน้าต่างทันที
async function submitTechSpecs(event, id) {
  event.preventDefault();
  const payload = {
    id: id,
    controlBox: document.getElementById(`inputControlBox_${id}`)?.value.trim() || '',
    lampType: document.getElementById(`inputLampType_${id}`)?.value.trim() || '',
    wireSize: document.getElementById(`inputWireSize_${id}`)?.value.trim() || '',
    extraTech: document.getElementById(`inputExtraTech_${id}`)?.value.trim() || ''
  };

  showLoadingModal("⚡ กำลังบันทึกข้อมูลเทคนิค...", "กรุณารอสักครู่");

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveTechSpecs', data: payload })
    }).then(r => r.json());

    hideLoadingModal();

    if (res && res.success) {
      showQuietAlert("✅ บันทึกข้อมูลทางเทคนิคสำเร็จ");

      // 🟢 1. อัปเดตข้อมูลในหน่วยความจำ (currentActiveItemRaw) ทันที
      if (currentActiveItemRaw && currentActiveItemRaw.ID === id) {
        currentActiveItemRaw['ตู้ควบคุม/เบรกเกอร์'] = payload.controlBox;
        currentActiveItemRaw['ตู้ควบคุม_เบรกเกอร์'] = payload.controlBox;
        currentActiveItemRaw.controlBox = payload.controlBox;

        currentActiveItemRaw['หลอดไฟที่ติดตั้ง'] = payload.lampType;
        currentActiveItemRaw.lampType = payload.lampType;

        currentActiveItemRaw['ขนาดสายไฟ'] = payload.wireSize;
        currentActiveItemRaw.wireSize = payload.wireSize;

        currentActiveItemRaw['ข้อมูลเทคนิคอื่นๆ'] = payload.extraTech;
        currentActiveItemRaw['อื่นๆ'] = payload.extraTech;
        currentActiveItemRaw.extraTech = payload.extraTech;
      }

      // 🟢 2. อัปเดตข้อมูลในรายการหลัก (allData)
      const targetInAll = allData.find(x => x.ID === id);
      if (targetInAll) {
        Object.assign(targetInAll, currentActiveItemRaw);
      }

      // 🟢 3. เรนเดอร์การ์ดแสดงผลบน Modal ใหม่ทันที
      renderTechSpecsSection(currentActiveItemRaw);

      // 🟢 4. โหลดพิกัด/ข้อมูลซิงค์เบื้องหลัง
      if (typeof loadMarkers === 'function') loadMarkers();

    } else {
      alert("❌ บันทึกล้มเหลว: " + (res ? res.message : 'เกิดข้อผิดพลาด'));
    }
  } catch(e) {
    hideLoadingModal();
    alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ: " + e.toString());
  }
}

async function apiPost(action, data = {}) {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data }),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`HTTP status ${response.status}`);
  return await response.json();
}

function initMap() {
  try {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || map) return;

    const streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; CartoDB'
    });
    const satBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: '&copy; Esri World Imagery', className: 'clean-satellite-tiles'
    });
    const satRoads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, opacity: 0.75
    });
    const satLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd', className: 'clean-satellite-labels'
    });
    const cleanSatelliteLayer = L.layerGroup([satBase, satRoads, satLabels]);

    map = L.map('map', { center: [13.745, 100.62], zoom: 11, layers: [streetLayer] });
    markersLayer = L.markerClusterGroup({ maxClusterRadius: 50, disableClusteringAtZoom: 17 });
    markersLayer.addTo(map);

    L.control.layers({ "🗺️ แผนที่ถนน": streetLayer, "🛰️ ภาพดาวเทียม (Minimal)": cleanSatelliteLayer }, null, { position: 'topleft' }).addTo(map);
    setTimeout(() => { map.invalidateSize(); }, 300);
  } catch (err) {
    console.error("Map initialization failed:", err);
  }
}

function resetMapToDefaultView() {
  if (!map) return;
  const selectedLocation = document.getElementById('locationFilter')?.value || 'all';
  if (selectedLocation !== "all" && masterFilteredList && masterFilteredList.length > 0) {
    const firstAsset = masterFilteredList[0];
    if (firstAsset.Lat && firstAsset.Lng) {
      map.setView([firstAsset.Lat, firstAsset.Lng], 15, { animate: true, duration: 0.5 });
      showQuietAlert("🎯 โฟกัสกลับไปยังจุดเริ่มต้นของตำแหน่งที่เลือก");
      return;
    }
  }
  map.setView([13.745, 100.62], 11, { animate: true, duration: 0.5 });
  showQuietAlert("🏠 รีเซ็ตมุมมองแผนที่เรียบร้อย");
}

function handleBMAMaskOverlay(show, selectedLoc) {
  if (!map) return;
  if (bmaMaskLayer) { map.removeLayer(bmaMaskLayer); bmaMaskLayer = null; }
  if (bmaDistrictsLayer) { map.removeLayer(bmaDistrictsLayer); bmaDistrictsLayer = null; }
  if (!show) return;

  try {
    if (bmaCachedGeoJSON) {
      drawBMAData(bmaCachedGeoJSON, selectedLoc);
    } else {
      fetch('https://cdn.jsdelivr.net/gh/pcrete/gsvloader-demo@master/geojson/Bangkok-districts.geojson')
        .then(res => res.json())
        .then(data => {
          bmaCachedGeoJSON = data;
          drawBMAData(data, selectedLoc);
        }).catch(() => {});
    }
  } catch(err) {}
}

function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function checkFeatureContainsDamaged(feature, damagedPoints) {
  if (!damagedPoints || damagedPoints.length === 0) return false;
  const geom = feature.geometry;
  if (!geom) return false;

  for (let p = 0; p < damagedPoints.length; p++) {
    const pt = [damagedPoints[p].lat, damagedPoints[p].lng];
    if (geom.type === 'Polygon') {
      const poly = geom.coordinates[0].map(c => [c[1], c[0]]);
      if (isPointInPolygon(pt, poly)) return true;
    } else if (geom.type === 'MultiPolygon') {
      for (let k = 0; k < geom.coordinates.length; k++) {
        const poly = geom.coordinates[k][0].map(c => [c[1], c[0]]);
        if (isPointInPolygon(pt, poly)) return true;
      }
    }
  }
  return false;
}

function drawBMAData(data, targetLocName) {
  const damagedPoints = [];
  allData.forEach(item => {
    const st = (item.Status || item.status || '').toString().trim();
    if ((st === 'ชำรุด' || st === 'รอจัดจ้าง') && item.Lat && item.Lng) {
      const lat = parseFloat(item.Lat), lng = parseFloat(item.Lng);
      if (!isNaN(lat) && !isNaN(lng)) damagedPoints.push({ lat: lat, lng: lng });
    }
  });

  let matchingDistrictName = "";
  if (targetLocName && targetLocName !== "all" && allData.length > 0) {
    const matchedAsset = allData.find(x => x['ที่ตั้ง'] === targetLocName);
    if (matchedAsset && matchedAsset.Note) matchingDistrictName = matchedAsset.Note.toString().trim();
  }

  function isTrashBox(feature) {
    const geom = feature.geometry;
    if (!geom) return true;
    let pointsCount = (geom.type === 'Polygon') ? geom.coordinates[0].length : ((geom.type === 'MultiPolygon') ? geom.coordinates[0][0].length : 0);
    return pointsCount <= 5;
  }

  bmaDistrictsLayer = L.geoJSON(data, {
    filter: feature => !isTrashBox(feature),
    style: feature => {
      const props = feature.properties || {};
      const dName = props.dname || props.dist_th || props.name || '';
      const isSelected = matchingDistrictName && dName.toString().includes(matchingDistrictName);
      const hasDamaged = checkFeatureContainsDamaged(feature, damagedPoints);

      if (isSelected) return { color: '#059669', weight: 2.5, fillColor: '#34d399', fillOpacity: 0.15 };
      if (hasDamaged) return { color: '#e11d48', weight: 2.0, fillColor: '#0f172a', fillOpacity: 0.35 };
      return { color: '#047857', weight: 1.0, fillColor: '#ffffff', fillOpacity: 0.0 };
    }
  }).addTo(map);

  const worldOuterRing = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
  const maskRings = [worldOuterRing];
  data.features.forEach(feature => {
    if (isTrashBox(feature)) return;
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      geom.coordinates.forEach(ring => maskRings.push(ring.map(c => [c[1], c[0]])));
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(polygon => polygon.forEach(ring => maskRings.push(ring.map(c => [c[1], c[0]]))));
    }
  });

  bmaMaskLayer = L.polygon(maskRings, { stroke: false, fillColor: '#0f172a', fillOpacity: 0.52, interactive: false }).addTo(map);
}

// 🌟 สร้างหมุดแยกสีตามสถานะ: ปกติ=เขียว, ชำรุด=แดง, รอจัดจ้าง=เหลือง, รอจำหน่าย=ส้ม
function createNumberedIcon(text, status) {
  let borderColor = '#10b981', bgColor = '#ecfdf5', textColor = '#047857';
  if (status === 'ชำรุด') { 
    borderColor = '#ef4444'; bgColor = '#fef2f2'; textColor = '#dc2626'; 
  } else if (status === 'รอจัดจ้าง') { 
    borderColor = '#f59e0b'; bgColor = '#fffbeb'; textColor = '#b45309'; // 🌟 สีเหลืองทอง
  } else if (status === 'รอจำหน่าย') { 
    borderColor = '#f97316'; bgColor = '#fff7ed'; textColor = '#c2410c'; 
  } else if (status === 'จำหน่ายแล้ว') { 
    borderColor = '#6b7280'; bgColor = '#f3f4f6'; textColor = '#374151'; 
  }
  
  const style = `background-color: ${bgColor}; border: 2.5px solid ${borderColor}; color: ${textColor}; border-radius: 8px; padding: 3px 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; box-shadow: 0 3px 8px rgba(0,0,0,0.25); white-space: nowrap;`;
  return L.divIcon({ html: `<div style="${style}">${text}</div>`, iconSize: [85, 26], iconAnchor: [42, 13], className: 'custom-numbered-icon' });
}

async function loadMarkers(userCode) {
  if (userCode !== undefined) currentUserCode = userCode;
  showQuietAlert("⏳ กำลังเชื่อมต่อฐานข้อมูลคลังครุภัณฑ์...");

  try {
    const res = await apiGet('getEquipmentData', { userCode: currentUserCode });
    if (res && res.success) {
      allData = processDataSequence(res.data || []);
      updateStatisticsCounters(allData);
      initFilterDropdowns(allData);

      apiGet('getRepairHistory').then(historyRes => {
        if (historyRes && historyRes.success) {
          globalReportCounts = {};
          (historyRes.data || []).forEach(h => {
            if (h.assetId) {
              const id = h.assetId.toString().trim().toUpperCase();
              globalReportCounts[id] = (globalReportCounts[id] || 0) + 1;
            }
          });
          applyFilters();
          if (isTechnician) {
            renderDamagedTable();
            renderEstimateTable(historyRes.data || []);
            loadAllRepairsHistory();
          }
        }
      });

      applyFilters();
      showQuietAlert("⚡ โหลดข้อมูลพิกัดเสร็จสมบูรณ์");
    }
  } catch (err) {
    showQuietAlert("❌ ดึงข้อมูลล้มเหลว: " + err.toString());
  }
}

function processDataSequence(data) {
  const counters = {};
  data.forEach(item => {
    const loc = item['ที่ตั้ง'] || 'ไม่ระบุสถานที่';
    if (!counters[loc]) counters[loc] = 0;
    counters[loc]++;
    item.sequenceNum = counters[loc];
  });
  return data;
}

function updateStatisticsCounters(data) {
  if (!data) return;
  const total = data.length;
  const damaged = data.filter(x => (x.Status || x.status || '').toString().trim() === 'ชำรุด').length;
  const estimate = data.filter(x => (x.Status || x.status || '').toString().trim() === 'รอจัดจ้าง').length;
  const normal = data.filter(x => (x.Status || x.status || '').toString().trim() === 'ปกติ').length;
  const pending = data.filter(x => (x.Status || x.status || '').toString().trim() === 'รอจำหน่าย').length;
  const disposed = data.filter(x => (x.Status || x.status || '').toString().trim() === 'จำหน่ายแล้ว').length;

  document.getElementById('count_all').innerText = total;
  document.getElementById('count_normal').innerText = normal;
  document.getElementById('count_damaged').innerText = damaged;
  document.getElementById('count_estimate').innerText = estimate;
  document.getElementById('count_pending').innerText = pending;
  document.getElementById('count_disposed').innerText = disposed;
}

function initFilterDropdowns(data) {
  const dSelect = document.getElementById('departmentFilter');
  if (!dSelect || !data) return;

  if (isOfficer && !isAdmin && currentDepartment) {
    dSelect.innerHTML = `<option value="${currentDepartment}">🏢 ${currentDepartment}</option>`;
    dSelect.value = currentDepartment;
    dSelect.disabled = true;
  } else {
    const depts = [...new Set(data.map(x => x['หน่วยงาน']).filter(Boolean))];
    dSelect.innerHTML = '<option value="all">🏢 ทุกหน่วยงาน</option>';
    depts.forEach(d => dSelect.innerHTML += `<option value="${d}">${d}</option>`);
    dSelect.disabled = false;
  }
  updateLocationDropdownByDepartment(dSelect.value);
}

function updateLocationDropdownByDepartment(dept) {
  const lSelect = document.getElementById('locationFilter');
  if (!lSelect) return;
  let filteredByDept = (dept && dept !== 'all') ? allData.filter(x => x['หน่วยงาน'] === dept) : allData;
  const locs = [...new Set(filteredByDept.map(x => x['ที่ตั้ง']).filter(Boolean))];
  lSelect.innerHTML = '<option value="all">📍 ทุกสถานที่</option>';
  locs.forEach(l => lSelect.innerHTML += `<option value="${l}">${l}</option>`);
}

function onDepartmentFilterChange() {
  const dSelect = document.getElementById('departmentFilter');
  if (!dSelect) return;
  updateLocationDropdownByDepartment(dSelect.value);
  applyFilters();
}

function applyFilters() {
  let selectedDept = document.getElementById('departmentFilter')?.value || 'all';
  if (isOfficer && !isAdmin && currentDepartment) selectedDept = currentDepartment;
  
  const selectedLocation = document.getElementById('locationFilter')?.value || 'all';
  const selectedStatus = document.getElementById('statusFilter')?.value || 'all';
  
  if (markersLayer) markersLayer.clearLayers();
  
  const bounds = [];
  masterFilteredList = [];
  const newMarkers = [];
  markerDict = {};

  let totalCount = 0, normalCount = 0, damagedCount = 0, estimateCount = 0, pendingCount = 0, disposedCount = 0;

  if (allData && allData.length > 0) {
    allData.forEach(item => {
      if (isOfficer && !isAdmin && currentDepartment && item['หน่วยงาน'] !== currentDepartment) return;
      if (selectedDept !== 'all' && item['หน่วยงาน'] !== selectedDept) return;
      if (selectedLocation !== 'all' && item['ที่ตั้ง'] !== selectedLocation) return;
      
      totalCount++;
      const currentSt = (item.Status || item.status || '').toString().trim();
      if (currentSt === 'ปกติ') normalCount++;
      else if (currentSt === 'ชำรุด') damagedCount++;
      else if (currentSt === 'รอจัดจ้าง') estimateCount++;
      else if (currentSt === 'รอจำหน่าย') pendingCount++;
      else if (currentSt === 'จำหน่ายแล้ว') disposedCount++;
      
      if (selectedStatus !== 'all' && currentSt !== selectedStatus) return;
      if (selectedStatus === 'all' && (currentSt === 'รอจำหน่าย' || currentSt === 'จำหน่ายแล้ว')) return;
      if (!item.Lat || !item.Lng) return;

      masterFilteredList.push(item);
      const icon = createNumberedIcon(item.ID, currentSt);
      const marker = L.marker([item.Lat, item.Lng], { icon: icon });
      marker.on('click', () => openDetailsWorkspace(item));
      
      newMarkers.push(marker);
      bounds.push([item.Lat, item.Lng]);
      markerDict[item.ID] = marker;
    });
  }

  document.getElementById('count_all').innerText = totalCount;
  document.getElementById('count_normal').innerText = normalCount;
  document.getElementById('count_damaged').innerText = damagedCount;
  document.getElementById('count_estimate').innerText = estimateCount;
  document.getElementById('count_pending').innerText = pendingCount;
  document.getElementById('count_disposed').innerText = disposedCount;

  if (markersLayer) markersLayer.addLayers(newMarkers);
  handleBMAMaskOverlay(true, selectedLocation);

  currentMasterPage = 1;
  if (isOfficer) applyMasterSearch();
  if (isTechnician) renderDamagedTable();

  if (bounds.length > 0 && map) {
    map.setView(selectedLocation !== "all" ? [bounds[0][0], bounds[0][1]] : [13.745, 100.62], selectedLocation !== "all" ? 15 : 11);
  }
}

function openDetailsWorkspace(item) {
  currentActiveId = item.ID;
  currentActiveItemRaw = item;

  document.getElementById('wsTitle').innerText = item['ชื่อทรัพย์สิน'] || item.Name || '';
  document.getElementById('wsMetaId').innerText = 'เลขทะเบียนทรัพย์สิน: ' + (item['เลขทะเบียนทรัพย์สิน'] || '-');
  document.getElementById('wsDetailsGrid').innerHTML = `
    <div class="border-b pb-2 flex flex-col gap-1">
      <span class="font-bold text-slate-400 text-[11px] tracking-wide uppercase">หน่วยงานรับผิดชอบ:</span>
      <span class="text-slate-900 font-semibold text-xs sm:text-sm pl-0.5">${item['หน่วยงาน'] || '-'}</span>
    </div>
    <div class="pb-0.5 flex flex-col gap-1">
      <span class="font-bold text-slate-400 text-[11px] tracking-wide uppercase">สถานที่ / ที่ตั้งหลัก:</span>
      <span class="text-emerald-800 font-bold text-xs sm:text-sm flex items-center gap-1">📍 ${item['ที่ตั้ง'] || '-'}</span>
    </div>
  `;

  // 🟢 เพิ่มการเรียกเรนเดอร์ส่วนข้อมูลทางเทคนิควิศวกรรมเฉพาะ (Admin & Tech)
  renderTechSpecsSection(item);

  const navBtn = document.getElementById('wsNavBtn');
  const streetViewBtn = document.getElementById('wsStreetViewBtn');
  if (item.Lat && item.Lng) {
    const lat = parseFloat(item.Lat), lng = parseFloat(item.Lng);
    navBtn.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    navBtn.classList.remove('hidden');
    streetViewBtn.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    streetViewBtn.classList.remove('hidden');
  } else {
    navBtn?.classList.add('hidden');
    streetViewBtn?.classList.add('hidden');
  }

  const badge = document.getElementById('wsStatusBadge');
  const currentSt = (item.Status || item.status || '').toString().trim();
  const idCapsule = `<span class="bg-white px-2 py-0.5 rounded-md border text-xs font-bold text-slate-700 mr-1.5 shadow-2xs">${item.ID}</span>`;
  if (currentSt === 'ชำรุด') {
    badge.innerHTML = idCapsule + ' 🔴 ชำรุด';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-red-50 text-red-700 border border-red-200 flex items-center';
  } else if (currentSt === 'รอจัดจ้าง') {
    badge.innerHTML = idCapsule + ' 🟡 รอจัดจ้าง (ส่งประมาณราคา)';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 flex items-center';
  } else if (currentSt === 'รอจำหน่าย') {
    badge.innerHTML = idCapsule + ' ⏳ รอจำหน่าย';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 flex items-center';
  } else if (currentSt === 'จำหน่ายแล้ว') {
    badge.innerHTML = idCapsule + ' 📦 จำหน่ายแล้ว';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-gray-100 text-gray-700 border border-gray-300 flex items-center';
  } else {
    badge.innerHTML = idCapsule + ' 🟢 ปกติ';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center';
  }

  const img = document.getElementById('wsImg'), noImg = document.getElementById('wsNoImg');
  if (item.Image) {
    img.src = item.Image; img.classList.remove('hidden'); noImg.classList.add('hidden');
  } else {
    img.src = ""; img.classList.add('hidden'); noImg.classList.remove('hidden');
  }

  document.getElementById('repairFormContainer')?.classList.add('hidden');
  document.getElementById('technicianFormContainer')?.classList.add('hidden');
  document.getElementById('repairEquipId').value = item.ID;
  document.getElementById('techEquipId').value = item.ID;

  const editBtn = document.getElementById('officerEditBtn');
  if (editBtn) {
    if (isOfficer && (currentDepartment === "ส่วนยุทธศาสตร์พื้นที่สีเขียว" || currentDepartment === item['หน่วยงาน'])) {
      editBtn.classList.remove('hidden');
    } else {
      editBtn.classList.add('hidden');
    }
  }

  const btnAction = document.getElementById('btnActionToggle');
  if (btnAction) {
    if (currentSt === 'ปกติ') {
      btnAction.innerText = (isOfficer || isTechnician) ? "🚨 ดำเนินการส่งเรื่องแจ้งซ่อมแซมครุภัณฑ์" : "🔒 กรุณายืนยันรหัสเข้าสู่ระบบเพื่อดำเนินการแจ้งซ่อม";
      btnAction.className = (isOfficer || isTechnician) ? "w-full text-white font-bold p-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all bg-rose-600 hover:bg-rose-700 block cursor-pointer text-center" : "w-full text-slate-400 font-bold p-2.5 rounded-xl text-xs sm:text-sm border bg-slate-50 cursor-not-allowed block text-center";
    } else if (currentSt === 'ชำรุด') {
      btnAction.innerText = isTechnician ? "🔧 ดำเนินการบันทึกรายงานผลการซ่อมบำรุง" : "🔴 อุปกรณ์ชำรุด (อยู่ระหว่างดำเนินการซ่อม)";
      btnAction.className = isTechnician ? "w-full text-slate-950 font-bold p-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all bg-amber-500 hover:bg-amber-600 block cursor-pointer text-center" : "w-full text-slate-500 font-bold p-2.5 rounded-xl text-xs sm:text-sm border bg-slate-100 cursor-not-allowed block text-center";
    } else if (currentSt === 'รอจัดจ้าง') {
      btnAction.innerText = (isOfficer || isTechnician) ? "📄 ดำเนินการปิดงานจัดจ้างตามสัญญา" : "🟡 อยู่ระหว่างขั้นตอนจัดซื้อจัดจ้าง";
      btnAction.className = (isOfficer || isTechnician) ? "w-full text-white font-bold p-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all bg-amber-600 hover:bg-amber-700 block cursor-pointer text-center" : "w-full text-amber-800 font-bold p-2.5 rounded-xl text-xs sm:text-sm border bg-amber-50 cursor-not-allowed block text-center";
    } else {
      btnAction.innerText = "📦 ครุภัณฑ์ถูกจำหน่ายออกจากระบบ";
      btnAction.className = "w-full text-slate-400 font-bold p-2.5 rounded-xl text-xs sm:text-sm border bg-slate-50 cursor-not-allowed block text-center";
    }
  }

  const uploadedQr = document.getElementById('wsUploadedQr'), noQr = document.getElementById('wsNoQrUploaded'), dlQr = document.getElementById('wsDownloadQrBtn');
  const qrUrl = (item.QRCode && item.QRCode.includes('http')) ? item.QRCode : ((item.Note && item.Note.includes('http')) ? item.Note : '');
  if (qrUrl) {
    uploadedQr.src = qrUrl; uploadedQr.classList.remove('hidden'); noQr.classList.add('hidden'); dlQr.classList.remove('hidden');
  } else {
    uploadedQr.src = ""; uploadedQr.classList.add('hidden'); noQr.classList.remove('hidden'); dlQr.classList.add('hidden');
  }

  refreshHistoryView(item.ID);
  document.getElementById('detailsModal')?.classList.remove('hidden');
}

function closeModal() { document.getElementById('detailsModal')?.classList.add('hidden'); }

// ==========================================
// 📜 แสดงประวัติการบำรุงรักษาอย่างละเอียด ( Timeline View )
// ==========================================
// ==========================================
// 📜 แสดงประวัติการบำรุงรักษาอย่างละเอียด ( Timeline View + Cache Optimization )
// ==========================================
async function refreshHistoryView(equipId) {
  const container = document.getElementById('wsRepairHistoryContainer');
  if (!container) return;

  const searchKey = equipId.toString().trim().toUpperCase();
  let history = window.allRepairHistoryData || [];

  // 🟢 1. หากยังไม่มีข้อมูลใน Memory Cache ให้แสดงข้อความรอ และดึงจาก API เพียงครั้งเดียว
  if (history.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-4 text-xs font-medium">⏳ กำลังโหลดประวัติไทม์ไลน์การบำรุงรักษาอย่างละเอียด...</p>';
    try {
      const res = await apiGet('getRepairHistory');
      if (res && res.success && Array.isArray(res.data)) {
        history = res.data;
        window.allRepairHistoryData = res.data; // ⚡ บันทึกใส่ Memory Cache สำหรับใช้ครั้งถัดไปทันที
      }
    } catch (e) {
      console.warn("API load failed, fallback to memory:", e);
    }
  }

  // 2. กรองประวัติทั้งหมดของครุภัณฑ์ ID นี้ (รวมทุกสถานะ)
  const filtered = history.filter(h => h && h.assetId && h.assetId.toString().trim().toUpperCase() === searchKey);

  // 3. เรียงลำดับไทม์ไลน์: รายการล่าสุดอยู่บนสุด
  filtered.sort((a, b) => {
    const parseDate = (dStr) => {
      if (!dStr) return 0;
      const p = dStr.split('/');
      if (p.length < 3) return 0;
      let y = parseInt(p[2], 10);
      if (y > 2400) y -= 543;
      return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
    };
    return parseDate(b.date) - parseDate(a.date);
  });

  // อัปเดตรหัสใบงานในฟอร์มช่างกรณีมีใบงานค้าง
  const activeTicket = filtered.find(h => h.status === 'รอดำเนินการ' || h.status === 'รอจัดจ้าง');
  const techRepIdInput = document.getElementById('techRepairId');
  const badge = document.getElementById('techRepairIdBadge');

  if (activeTicket) {
    if (techRepIdInput) techRepIdInput.value = activeTicket.repairId;
    if (badge) {
      badge.innerText = `📋 ดำเนินการใบงาน: ${activeTicket.repairId} (${activeTicket.status})`;
      badge.classList.remove('hidden');
    }
  } else {
    if (badge) badge.classList.add('hidden');
  }

  // Header สรุปสถิติ + ปุ่ม Export PDF รายงานไทม์ไลน์ประวัติ
  const summaryHtml = `
    <div class="bg-slate-100 text-slate-700 p-2.5 rounded-xl border border-slate-200 text-[11px] font-bold flex justify-between items-center mb-3 shadow-2xs w-full">
      <span class="flex items-center gap-1"><i class="ph-bold ph-clock-counter-clockwise text-emerald-600"></i> ประวัติประมวลผลไทม์ไลน์: ${filtered.length} ใบงาน</span>
      ${filtered.length > 0 ? `
        <button type="button" onclick="exportHistoryPDF('${equipId}')" class="bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer">
          <i class="ph-bold ph-file-pdf text-sm"></i> Export PDF
        </button>
      ` : ''}
    </div>
  `;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col gap-1 w-full">
        ${summaryHtml}
        <div class="text-slate-400 text-center py-8 bg-white border border-slate-200 rounded-xl shadow-2xs text-xs">
          <i class="ph-bold ph-folder-open text-2xl text-slate-300 mb-1 block"></i>
          ไม่พบประวัติบันทึกข้อมูลสำหรับครุภัณฑ์นี้
        </div>
      </div>`;
    return;
  }

  // 4. วนลูปแจงรายละเอียดทุกขั้นตอน + แสดงรูปภาพพรีวิว (Thumbnail)
  let timelineHtml = '';
  filtered.forEach((h) => {
    let badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    let accentBorder = 'border-l-emerald-500';
    
    if (h.status === 'ชำรุด' || h.status === 'รอดำเนินการ') {
      badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200';
      accentBorder = 'border-l-rose-500';
    } else if (h.status === 'รอจัดจ้าง') {
      badgeStyle = 'bg-amber-50 text-amber-800 border-amber-300';
      accentBorder = 'border-l-amber-500';
    }

    // 🔍 ถอดรหัสข้อความแยกตามขั้นตอน
    let fullText = h.details || '';
    let initialReportText = fullText;
    let techLogText = '';
    let materialsText = '';
    let contractText = '';

    if (fullText.includes('[บันทึกจัดจ้าง]:')) {
      const parts = fullText.split('[บันทึกจัดจ้าง]:');
      fullText = parts[0].trim();
      contractText = parts[1].trim();
    }

    if (fullText.includes('[ช่างบันทึก]:')) {
      const parts = fullText.split('[ช่างบันทึก]:');
      initialReportText = parts[0].trim();
      techLogText = parts[1].trim();
    } else if (fullText.includes('OP_TYPE:')) {
      techLogText = fullText;
      initialReportText = 'แจ้งซ่อมผ่านระบบ';
    }

    if (techLogText.includes('OP_TYPE:')) {
      const opParts = techLogText.split('##');
      let detailsVal = '', typeVal = '';
      opParts.forEach(p => {
        if (p.startsWith('OP_TYPE:')) typeVal = p.replace('OP_TYPE:', '');
        if (p.startsWith('DETAILS:')) detailsVal = p.replace('DETAILS:', '');
        if (p.startsWith('MATERIALS:')) materialsText = p.replace('MATERIALS:', '');
      });
      techLogText = `[${typeVal}] ${detailsVal}`;
    }

    // พรีวิวรูปภาพในแต่ละขั้นตอน
    const imagePreviewHtml = h.imageAfter ? `
      <div class="mt-2 pt-2 border-t border-slate-100 flex items-center gap-3">
        <div class="relative group cursor-pointer" onclick="openImageModal('${h.imageAfter}')">
          <img src="${h.imageAfter}" alt="หลักฐาน" class="h-16 w-20 object-cover rounded-lg border border-slate-200 shadow-2xs group-hover:opacity-90 transition-opacity">
        </div>
        <div class="text-[10px] text-slate-500 space-y-0.5">
          <span class="font-bold text-slate-700 block">📷 ภาพถ่าย/เอกสารหลักฐานประกอบ</span>
          <span class="text-emerald-700 cursor-pointer hover:underline font-medium" onclick="openImageModal('${h.imageAfter}')">คลิกเพื่อดูภาพขยายเต็มจอ</span>
        </div>
      </div>
    ` : '';

    timelineHtml += `
      <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm border-l-4 ${accentBorder} space-y-3 mb-3">
        
        <!-- Header ใบงาน -->
        <div class="flex justify-between items-center border-b border-slate-100 pb-2.5">
          <div>
            <span class="font-extrabold text-slate-900 text-xs sm:text-sm">📌 ใบงานเลขที่: ${h.repairId}</span>
            <span class="text-[11px] text-slate-400 font-medium ml-2">📅 ${h.date}</span>
          </div>
          <span class="px-2.5 py-1 rounded-full border text-[10px] font-bold ${badgeStyle}">${h.status}</span>
        </div>

        <!-- ไทม์ไลน์ขั้นตอน -->
        <div class="space-y-2.5 pl-1 border-l-2 border-slate-100 ml-1.5">
          
          <!-- ขั้นตอนที่ 1: การแจ้งซ่อม -->
          <div class="relative pl-4">
            <div class="absolute -left-[9px] top-0.5 w-4 h-4 rounded-full bg-rose-500 border-2 border-white flex items-center justify-center text-[8px] text-white font-bold">1</div>
            <h6 class="font-bold text-slate-800 text-xs flex items-center gap-1">
              <i class="ph-bold ph-warning-circle text-rose-600"></i> ขั้นตอนที่ 1: ข้อมูลการแจ้งซ่อม
            </h6>
            <div class="bg-rose-50/50 p-2.5 rounded-xl border border-rose-100 mt-1 text-[11px] text-slate-700 leading-relaxed">
              <div><b>อาการชำรุด:</b> ${initialReportText}</div>
              <div class="text-[10px] text-slate-500 mt-1"><b>ผู้รายงาน:</b> ${h.reporter || '-'} ${h.phone ? `(📞 ${h.phone})` : ''}</div>
            </div>
          </div>

          <!-- ขั้นตอนที่ 2: งานช่างเทคนิค / ส่งประมาณราคา -->
          ${techLogText ? `
            <div class="relative pl-4">
              <div class="absolute -left-[9px] top-0.5 w-4 h-4 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center text-[8px] text-white font-bold">2</div>
              <h6 class="font-bold text-slate-800 text-xs flex items-center gap-1">
                <i class="ph-bold ph-wrench text-amber-600"></i> ขั้นตอนที่ 2: การบันทึกงานช่างเทคนิค / ส่งประมาณราคา
              </h6>
              <div class="bg-amber-50/50 p-2.5 rounded-xl border border-amber-200/80 mt-1 text-[11px] text-slate-700 leading-relaxed space-y-1">
                <div><b>ผลจัดการหน้างาน:</b> ${techLogText}</div>
                ${materialsText ? `<div class="text-slate-600 border-t border-amber-200/60 pt-1 mt-1"><i class="ph-bold ph-package text-amber-700"></i> <b>รายการวัสดุอุปกรณ์ที่ใช้:</b> ${materialsText}</div>` : ''}
              </div>
            </div>
          ` : ''}

          <!-- ขั้นตอนที่ 3: สรุปงานจัดจ้างตามสัญญา -->
          ${contractText ? `
            <div class="relative pl-4">
              <div class="absolute -left-[9px] top-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-[8px] text-white font-bold">3</div>
              <h6 class="font-bold text-emerald-900 text-xs flex items-center gap-1">
                <i class="ph-bold ph-file-text text-emerald-600"></i> ขั้นตอนที่ 3: สรุปผลงานสัญญาจัดจ้าง
              </h6>
              <div class="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-200 mt-1 text-[11px] text-slate-800 leading-relaxed">
                ${contractText}
              </div>
            </div>
          ` : ''}

        </div>

        <!-- แสดงภาพประกอบประจำใบงาน -->
        ${imagePreviewHtml}

      </div>
    `;
  });

  container.innerHTML = `
    <div class="flex flex-col gap-1 w-full">
      ${summaryHtml}
      <div id="pdfPrintArea" class="w-full">
        ${timelineHtml}
      </div>
    </div>
  `;
}

// ==========================================
// 🛠️ ฟังก์ชันแปลงค่าสี oklch เป็น rgb(...) ด้วย HTML5 Canvas
// ==========================================
function convertOklchToRgb(colorStr) {
  if (!colorStr || typeof colorStr !== 'string' || !colorStr.includes('oklch')) return colorStr;
  try {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 1;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
  } catch (e) {
    return '#1e293b';
  }
}

// ==========================================
// 📄 3. ฟังก์ชัน Export PDF ปุ่มสีแดง (พิมพ์เฉพาะไทม์ไลน์ประวัติในรูปแบบ Native Print)
// ==========================================
function exportHistoryPDF(equipId) {
  const container = document.getElementById('wsRepairHistoryContainer');
  if (!container) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบพื้นที่ข้อมูลสำหรับออกเอกสาร PDF");
    return;
  }

  // 🟢 เปิด window ทันทีเพื่อป้องกัน Pop-up Blocker
  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ กรุณาอนุญาต Pop-up ในเบราว์เซอร์เพื่อเปิดหน้าพิมพ์");
    return;
  }

  // คัดลอก DOM ประวัติไทม์ไลน์พร้อมลบปุ่ม Export ด้านในออก
  const cloned = container.cloneNode(true);
  const btnInClone = cloned.querySelector('button');
  if (btnInClone) btnInClone.remove();

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ประวัติการซ่อมบำรุง_${equipId || 'Report'}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/@phosphor-icons/web"></script>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { font-family: "Sarabun", "Garuda", Tahoma, sans-serif; background: #fff; padding: 10px; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body class="antialiased">
      <div class="mb-4 border-b pb-2 text-center">
        <h2 class="text-lg font-bold text-slate-800">📜 บันทึกไทม์ไลน์ประวัติการบำรุงรักษา</h2>
        <p class="text-xs text-slate-500">รหัสครุภัณฑ์: ${equipId || '-'} | พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH')}</p>
      </div>
      <div>
        ${cloned.innerHTML}
      </div>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 600);
        };
      </script>
    </body>
    </html>
  `);

  printWindow.document.close();
}

// ==========================================
// 📄 ฟังก์ชันเรียกออกใบเบิกวัสดุอุปกรณ์ (PDF)
// ==========================================
function triggerExportMaterialPDF(repairId) {
  if (!repairId) return;

  if (typeof showQuietAlert === 'function') {
    showQuietAlert("📄 ระบบกำลังสร้างเอกสารใบเบิกวัสดุอุปกรณ์ (PDF)...");
  }

  google.script.run
    .withSuccessHandler(function(res) {
      if (res && res.success) {
        const a = document.createElement('a');
        a.href = "data:application/pdf;base64," + res.base64;
        a.download = res.filename;
        a.click();
        if (typeof showQuietAlert === 'function') {
          showQuietAlert("✅ ดาวน์โหลดใบเบิกวัสดุอุปกรณ์สำเร็จ");
        }
      } else {
        if (typeof showQuietAlert === 'function') {
          showQuietAlert("❌ " + (res ? res.message : "เกิดข้อผิดพลาดในการสร้างเอกสาร"));
        }
      }
    })
    .withFailureHandler(function(err) {
      if (typeof showQuietAlert === 'function') {
        showQuietAlert("❌ ออกใบเบิกไม่สำเร็จ: " + err.toString());
      }
    })
    .exportMaterialRequisitionPDF(repairId);
}

function findAndOpenAsset(id) {
  const target = allData.find(x => x.ID.toString().trim().toUpperCase() === id.toString().trim().toUpperCase());
  if (target) {
    openDetailsWorkspace(target);
    const m = markerDict[target.ID];
    if (markersLayer && m) markersLayer.zoomToShowLayer(m, () => {});
  }
}

function toggleActionForm() {
  if (!currentActiveItemRaw) return;
  const currentSt = (currentActiveItemRaw.Status || currentActiveItemRaw.status || '').toString().trim();
  
  if (currentSt === 'ปกติ' && (isOfficer || isTechnician)) {
    document.getElementById('repairFormContainer')?.classList.toggle('hidden');
  } else if (currentSt === 'ชำรุด' && isTechnician) {
    const box = document.getElementById('technicianFormContainer');
    box?.classList.toggle('hidden');
    if (!box?.classList.contains('hidden')) {
      document.getElementById('techActionType').value = 'ซ่อมแซมเอง';
      toggleTechActionFields();
    }
  } else if (currentSt === 'รอจัดจ้าง' && (isOfficer || isTechnician)) {
    // 🌟 เปิด Modal บันทึกปิดงานสัญญาจัดจ้าง
    openProcurementModal(currentActiveItemRaw.ID);
  }
}

function toggleTechActionFields() {
  const type = document.getElementById('techActionType')?.value;
  const wrapper = document.getElementById('techMaterialsWrapper');
  const list = document.getElementById('dynamicMaterialsList');
  if (type === 'ซ่อมแซมเอง') {
    wrapper?.classList.remove('hidden');
    if (list && list.children.length === 0) addMaterialRow();
  } else {
    wrapper?.classList.add('hidden');
    if (list) list.innerHTML = '';
  }
}

function addMaterialRow() {
  const container = document.getElementById('dynamicMaterialsList');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'flex gap-1.5 items-center material-row animate-fade-in';
  row.innerHTML = `
    <input type="text" placeholder="ชื่อวัสดุ/อุปกรณ์" class="mat-name w-3/5 p-1 bg-white border rounded text-[10px]" required>
    <input type="number" min="1" placeholder="จำนวน" class="mat-qty w-1/5 p-1 bg-white border rounded text-[10px] text-center" required>
    <button type="button" onclick="this.parentElement.remove()" class="w-1/5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-bold py-1 rounded cursor-pointer">ลบ</button>
  `;
  container.appendChild(row);
}

async function handleRepairSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('repairSubmitBtn');
  if (btn) btn.disabled = true;

  const data = {
    id: document.getElementById('repairEquipId').value,
    details: document.getElementById('repair_details').value,
    reporter: document.getElementById('repair_reporter').value,
    phone: document.getElementById('repair_phone').value
  };

  showLoadingModal("🚨 กำลังส่งเรื่องแจ้งซ่อม...", "ระบบกำลังบันทึกข้อมูลและส่งแจ้งเตือน");
  try {
    const res = await apiPost('reportRepair', data);
    hideLoadingModal();
    if (btn) btn.disabled = false;
    showQuietAlert(res.message);
    if (res.success) {
      document.getElementById('repairForm').reset();
      loadMarkers();
      closeModal();
    }
  } catch (err) {
    hideLoadingModal();
    if (btn) btn.disabled = false;
    showQuietAlert("❌ เกิดข้อผิดพลาด: " + err.toString());
  }
}

async function handleTechSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('techSubmitBtn');
  if (btn) btn.disabled = true;

  const actionType = document.getElementById('techActionType').value;
  const techDetails = document.getElementById('techDetails').value;
  let materialsString = "ไม่ได้ใช้วัสดุอุปกรณ์";

  if (actionType === 'ซ่อมแซมเอง') {
    const matArray = [];
    document.querySelectorAll('.material-row').forEach(row => {
      const name = row.querySelector('.mat-name').value.trim();
      const qty = row.querySelector('.mat-qty').value.trim();
      if (name && qty) matArray.push(`${name} (${qty})`);
    });
    if (matArray.length > 0) materialsString = matArray.join(', ');
  }

  const completeDetails = `OP_TYPE:${actionType}##DETAILS:${techDetails}##MATERIALS:${materialsString}`;
  const assetId = document.getElementById('techEquipId').value;
  const data = {
    repairId: document.getElementById('techRepairId').value,
    assetId: assetId,
    details: completeDetails,
    technicianName: document.getElementById('techName').value,
    imageAfter: compressedImageMap['imageAfterFile'] || null
  };

  showLoadingModal("🔧 กำลังบันทึกผลงาน...", "ระบบกำลังประมวลผลรูปภาพและข้อมูล");

  try {
    const res = await apiPost('updateRepairStatus', data);
    hideLoadingModal();
    if (btn) btn.disabled = false;
    showQuietAlert(res.message);

    if (res.success) {
      document.getElementById('techForm').reset();
      document.getElementById('dynamicMaterialsList').innerHTML = '';
      removeImagePreview('preview_tech_after_box', 'preview_tech_after', ['imageAfterCapture', 'imageAfterFile']);
      
      // 🟢 1. ล้าง Memory Cache ประวัติซ่อมบำรุง เพื่อให้ดึงข้อมูลไทม์ไลน์ใหม่ทันที
      window.allRepairHistoryData = null;

      // 🟢 2. อัปเดตสถานะในหน่วยความจำทันที (ถ้าซ่อมแซมเอง สถานะครุภัณฑ์กลับเป็น "ปกติ")
      const newStatus = (actionType === 'ซ่อมแซมเอง' || actionType === 'ปิดงานซ่อม') ? 'ปกติ' : 'รอจัดจ้าง';
      
      if (currentActiveItemRaw && currentActiveItemRaw.ID === assetId) {
        currentActiveItemRaw.Status = newStatus;
        currentActiveItemRaw.status = newStatus;
      }
      
      const targetAsset = allData.find(x => x.ID === assetId);
      if (targetAsset) {
        targetAsset.Status = newStatus;
        targetAsset.status = newStatus;
      }

      // 🟢 3. อัปเดตหน้าต่างรายละเอียดและพิกัดบนแผนที่ทันทีโดยไม่ต้องรีเฟรชหน้าเว็บ
      if (currentActiveItemRaw && currentActiveItemRaw.ID === assetId) {
        openDetailsWorkspace(currentActiveItemRaw);
      }

      loadMarkers();
    }
  } catch (err) {
    hideLoadingModal();
    if (btn) btn.disabled = false;
    showQuietAlert("❌ เกิดข้อผิดพลาด: " + err.toString());
  }
}

// 🌟 จัดการตารางงานส่งประมาณราคา (รอจัดจ้าง)
function renderEstimateTable(historyData) {
  const tbody = document.getElementById('estimateAssetsTableBody');
  const container = document.getElementById('estimateAssetsContainer');
  if (!tbody || !container) return;

  estimateListRaw = (historyData || []).filter(h => h.status === 'รอจัดจ้าง');
  document.getElementById('estimateCountBadge').innerText = estimateListRaw.length + " รายการ";

  if (estimateListRaw.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400 font-medium">ไม่มีรายการส่งประมาณราคาคงค้าง</td></tr>';
    container.classList.remove('hidden');
    return;
  }

  let html = '';
  estimateListRaw.forEach(item => {
    const asset = allData.find(a => a.ID === item.assetId);
    const loc = asset ? asset['ที่ตั้ง'] : '-';
    html += `
      <tr class="hover:bg-amber-50/40 border-b last:border-none">
        <td class="p-2 text-center font-bold text-amber-900">${item.repairId}</td>
        <td class="p-2 text-center font-bold text-slate-700">${item.assetId}</td>
        <td class="p-2 text-slate-800 text-[11px] whitespace-pre-line">${item.details}</td>
        <td class="p-2 text-emerald-800 font-medium">📍 ${loc}</td>
        <td class="p-2 text-center">
          <button onclick="openProcurementModal('${item.assetId}', '${item.repairId}')" class="bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-md font-bold text-[11px] cursor-pointer shadow-2xs">
            📄 ปิดงานจัดจ้าง
          </button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
  container.classList.remove('hidden');
}

// 🌟 Modal จัดการปิดงานจัดจ้าง
async function openProcurementModal(assetId, repairId) {
  document.getElementById('proc_assetId').value = assetId;
  let repId = repairId;
  if (!repId) {
    const history = await apiGet('getRepairHistory');
    const ticket = (history.data || []).find(h => h.assetId === assetId && h.status === 'รอจัดจ้าง');
    if (ticket) repId = ticket.repairId;
  }
  document.getElementById('proc_repairId').value = repId || '';
  document.getElementById('proc_badge_info').innerText = `💡 ปิดงานครุภัณฑ์ ID: ${assetId} | ใบงาน: ${repId || '-'}`;
  document.getElementById('procurementModal')?.classList.remove('hidden');
}

function closeProcurementModal() {
  document.getElementById('procurementModal')?.classList.add('hidden');
  document.getElementById('procurementForm').reset();
  removeImagePreview('preview_proc_box', 'preview_proc', ['procCapture', 'procFile']);
}

async function handleProcurementSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('procSubmitBtn');
  btn.disabled = true;

  const data = {
    repairId: document.getElementById('proc_repairId').value,
    assetId: document.getElementById('proc_assetId').value,
    contractNo: document.getElementById('proc_contractNo').value,
    startDate: document.getElementById('proc_startDate').value,
    endDate: document.getElementById('proc_endDate').value,
    details: document.getElementById('proc_details').value,
    officerName: document.getElementById('proc_officerName').value,
    contractFile: compressedImageMap['procFile'] || null
  };

  showLoadingModal("📄 กำลังบันทึกปิดงานจัดจ้าง...", "กรุณารอสักครู่");

  try {
    const res = await apiPost('completeProcurement', data);
    hideLoadingModal();
    btn.disabled = false;
    showQuietAlert(res.message);
    if (res.success) {
      closeProcurementModal();
      closeModal();
      loadMarkers();
    }
  } catch(err) {
    hideLoadingModal();
    btn.disabled = false;
    showQuietAlert("❌ ปิดงานจัดจ้างล้มเหลว");
  }
}

function renderDamagedTable() {
  const tbody = document.getElementById('damagedAssetsTableBody');
  if (!tbody) return;
  const damagedList = allData.filter(x => (x.Status || x.status || '').toString().trim() === 'ชำรุด');
  if (damagedList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 font-medium">🎉 ไม่มีรายการครุภัณฑ์ชำรุดตกค้างในระบบ</td></tr>';
    return;
  }
  let html = '';
  damagedList.forEach(item => {
    html += `
      <tr class="hover:bg-slate-50 transition-colors border-b last:border-none">
        <td class="p-2.5 text-center font-bold text-slate-500">${item.ID}</td>
        <td class="p-2.5"><div class="font-bold text-slate-800">${item['ชื่อทรัพย์สิน'] || item.Name}</div><div class="text-[10px] text-slate-400">${item['เลขทะเบียนทรัพย์สิน'] || '-'}</div></td>
        <td class="p-2.5 text-slate-500"><div>${item['หน่วยงาน'] || '-'}</div><div class="text-[10px] text-emerald-600 font-medium">📍 ${item['ที่ตั้ง'] || '-'}</div></td>
        <td class="p-2.5 text-center"><button onclick="findAndOpenAsset('${item.ID}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2.5 py-1 rounded-md font-bold cursor-pointer">🔧 จัดการ</button></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function loadAllRepairsHistory() {
  const res = await apiGet('getRepairHistory');
  const history = res.data || [];
  const reportCounts = {};
  history.forEach(h => { if (h.assetId) reportCounts[h.assetId] = (reportCounts[h.assetId] || 0) + 1; });

  successListRaw = history.filter(h => h.status === 'ซ่อมเสร็จสิ้น');
  successListRaw.forEach(h => {
    h.totalReports = reportCounts[h.assetId] || 0;
    const asset = allData.find(a => a.ID === h.assetId);
    h.department = asset ? asset['หน่วยงาน'] : '-';
    h.location = asset ? asset['ที่ตั้ง'] : '-';
  });

  document.getElementById('successAssetsContainer')?.classList.remove('hidden');
  initSuccessDropdowns(successListRaw);
  applySuccessFilters();
}

function initSuccessDropdowns(data) {
  const sdSelect = document.getElementById('successDeptFilter');
  if (!sdSelect) return;
  const depts = [...new Set(data.map(x => x.department).filter(Boolean))];
  sdSelect.innerHTML = '<option value="all">🏢 ทุกหน่วยงาน</option>';
  depts.forEach(d => sdSelect.innerHTML += `<option value="${d}">${d}</option>`);
  updateSuccessLocationDropdown(sdSelect.value);
}

function updateSuccessLocationDropdown(dept) {
  const slSelect = document.getElementById('successLocFilter');
  if (!slSelect) return;
  let filtered = (dept && dept !== 'all') ? successListRaw.filter(x => x.department === dept) : successListRaw;
  const locs = [...new Set(filtered.map(x => x.location).filter(Boolean))];
  slSelect.innerHTML = '<option value="all">📍 ทุกสถานที่</option>';
  locs.forEach(l => slSelect.innerHTML += `<option value="${l}">${l}</option>`);
}

function onSuccessDeptFilterChange() {
  const sdSelect = document.getElementById('successDeptFilter');
  if (!sdSelect) return;
  updateSuccessLocationDropdown(sdSelect.value);
  applySuccessFilters();
}

function applySuccessFilters() {
  const selectedDept = document.getElementById('successDeptFilter')?.value || 'all';
  const selectedLoc = document.getElementById('successLocFilter')?.value || 'all';
  const query = document.getElementById('successSearchInput')?.value.toLowerCase().trim() || '';

  successListGlobal = successListRaw.filter(h => {
    if (selectedDept !== 'all' && h.department !== selectedDept) return false;
    if (selectedLoc !== 'all' && h.location !== selectedLoc) return false;
    if (query) {
      return (h.assetId && h.assetId.toLowerCase().includes(query)) ||
             (h.repairId && h.repairId.toLowerCase().includes(query)) ||
             (h.reporter && h.reporter.toLowerCase().includes(query)) ||
             (h.details && h.details.toLowerCase().includes(query));
    }
    return true;
  });

  document.getElementById('successCountBadge').innerText = successListGlobal.length + ' รายการ';
  currentPage = 1;
  displaySuccessTableRecords();
}

function displaySuccessTableRecords() {
  const tbody = document.getElementById('successAssetsTableBody');
  if (!tbody) return;
  if (successListGlobal.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400 font-medium">📊 ไม่มีบันทึกประวัติผลงานซ่อมเสร็จ</td></tr>';
    document.getElementById('paginationInfo').innerText = "หน้า 1 จาก 1";
    document.getElementById('prevPageBtn').disabled = true;
    document.getElementById('nextPageBtn').disabled = true;
    return;
  }

  const totalPages = Math.ceil(successListGlobal.length / recordsPerPage);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  document.getElementById('paginationInfo').innerText = `หน้า ${currentPage} จาก ${totalPages}`;
  document.getElementById('prevPageBtn').disabled = (currentPage === 1);
  document.getElementById('nextPageBtn').disabled = (currentPage === totalPages);

  const start = (currentPage - 1) * recordsPerPage;
  const records = successListGlobal.slice(start, start + recordsPerPage);
  let html = '';

  records.forEach(h => {
    html += `
      <tr class="hover:bg-slate-50 border-b last:border-none">
        <td class="p-2 text-center text-slate-600 font-medium">${h.date}<br/><b class="text-[10px] text-slate-400 font-bold">[${h.repairId}]</b></td>
        <td class="p-2 text-center font-bold text-slate-700">${h.assetId}</td>
        <td class="p-2 text-center"><span class="bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">${h.totalReports || 0} ครั้ง</span></td>
        <td class="p-2"><div class="font-semibold text-slate-800 whitespace-pre-line">${h.details}</div><div class="text-[10px] text-slate-400">👤 ช่าง/ผู้รับผิดชอบ: ${h.reporter} | 🏢 ${h.department} (📍 ${h.location})</div></td>
        <td class="p-2 text-center">${h.imageAfter ? `<button type="button" onclick="openImageModal('${h.imageAfter}')" class="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-200 font-bold hover:bg-emerald-100 text-[11px] cursor-pointer">🔍 ดูภาพ</button>` : '<span class="text-slate-300 text-[11px]">ไม่มีภาพ</span>'}</td>
        <td class="p-2 text-center"><button type="button" onclick="findAndOpenAsset('${h.assetId}')" class="bg-emerald-600 hover:bg-emerald-700 text-white py-1 px-2.5 rounded-lg font-bold text-[11px] cursor-pointer">👁️ ดูข้อมูล</button></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function changePage(dir) { currentPage += dir; displaySuccessTableRecords(); }

function applyMasterSearch() {
  const query = document.getElementById('masterSearchInput')?.value.toLowerCase().trim() || '';
  masterDisplayList = query ? masterFilteredList.filter(item => Object.values(item).some(v => String(v).toLowerCase().includes(query))) : [...masterFilteredList];
  currentMasterPage = 1;
  renderMasterInventoryTable();
}

function renderMasterInventoryTable() {
  const tbody = document.getElementById('masterAssetsTableBody');
  if (!tbody) return;
  document.getElementById('masterCountBadge').innerText = masterDisplayList.length + " รายการ";

  if (masterDisplayList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">⚠️ ไม่พบข้อมูลครุภัณฑ์</td></tr>';
    document.getElementById('masterPaginationInfo').innerText = "หน้า 1 จาก 1";
    document.getElementById('masterPrevBtn').disabled = true;
    document.getElementById('masterNextBtn').disabled = true;
    return;
  }

  const totalPages = Math.ceil(masterDisplayList.length / masterRecordsPerPage);
  currentMasterPage = Math.max(1, Math.min(currentMasterPage, totalPages));
  document.getElementById('masterPaginationInfo').innerText = `กำลังแสดงหน้า ${currentMasterPage} จาก ${totalPages}`;
  document.getElementById('masterPrevBtn').disabled = (currentMasterPage === 1);
  document.getElementById('masterNextBtn').disabled = (currentMasterPage === totalPages);

  const start = (currentMasterPage - 1) * masterRecordsPerPage;
  const records = masterDisplayList.slice(start, start + masterRecordsPerPage);
  let html = '';

  records.forEach(item => {
    let st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 rounded-full">🟢 ปกติ</span>';
    if(item.Status === 'ชำรุด') st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-700 rounded-full">🔴 ชำรุด</span>';
    else if(item.Status === 'รอจัดจ้าง') st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 rounded-full">🟡 รอจัดจ้าง</span>';
    else if(item.Status === 'รอจำหน่าย') st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-orange-50 text-orange-700 rounded-full">⏳ รอจำหน่าย</span>';
    else if(item.Status === 'จำหน่ายแล้ว') st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-700 rounded-full">📦 จำหน่ายแล้ว</span>';

    const count = globalReportCounts[item.ID] || 0;
    html += `
      <tr class="hover:bg-slate-50 border-b last:border-none">
        <td class="p-3 text-center font-bold text-slate-500">${item.ID}</td>
        <td class="p-3 font-semibold text-slate-900">${item['ชื่อทรัพย์สิน'] || item.Name}</td>
        <td class="p-3">${item['เลขทะเบียนทรัพย์สิน'] || '-'}</td>
        <td class="p-3 text-slate-500">${item['หน่วยงาน'] || '-'}</td>
        <td class="p-3 font-medium text-emerald-800">📍 ${item['ที่ตั้ง'] || '-'}</td>
        <td class="p-3 text-center"><span class="bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 rounded-full font-bold text-[11px]">${count} ครั้ง</span></td>
        <td class="p-3 text-center">${st}</td>
        <td class="p-3 text-center"><button onclick="findAndOpenAsset('${item.ID}')" class="bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 p-1 px-2.5 rounded font-bold text-[11px] cursor-pointer">🔍 ตรวจสอบ</button></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function changeMasterPage(dir) { currentMasterPage += dir; renderMasterInventoryTable(); }

function openIndexModalWindow() { document.getElementById('indexModalWindow')?.classList.remove('hidden'); }
function closeIndexModalWindow() { document.getElementById('indexModalWindow')?.classList.add('hidden'); }

async function loadIndexData() {
  const tbody = document.getElementById('indexSheetTableBody');
  try {
    const res = await apiGet('getIndexSheetData');
    if (res && res.data && res.data.length > 0) {
      indexRawData = res.data;
      indexHeaders = Object.keys(res.data[0]);
      applyIndexSearch();
    }
  } catch(e) {
    if (tbody) tbody.innerHTML = '<tr><td class="p-4 text-center text-rose-500 font-bold" colspan="2">❌ โหลดข้อมูลดัชนีไม่สำเร็จ</td></tr>';
  }
}

function applyIndexSearch() {
  const query = document.getElementById('indexSearchInput')?.value.toLowerCase().trim() || '';
  indexFilteredData = query ? indexRawData.filter(item => Object.values(item).some(v => String(v).toLowerCase().includes(query))) : [...indexRawData];
  document.getElementById('indexCountBadge').innerText = indexFilteredData.length + " รายการ";
  renderIndexTable();
}

function renderIndexTable() {
  const tbody = document.getElementById('indexSheetTableBody');
  if (!tbody) return;
  if (indexFilteredData.length === 0) {
    tbody.innerHTML = '<tr><td class="p-4 text-center text-slate-400" colspan="2">⚠️ ไม่พบข้อมูลดัชนีอ้างอิง</td></tr>';
    return;
  }
  let html = '';
  indexFilteredData.forEach(item => {
    const keyA = indexHeaders[0], keyB = indexHeaders[1];
    html += `
      <tr class="hover:bg-slate-50 transition-colors border-b last:border-none">
        <td class="p-2.5 text-center font-bold text-emerald-700 bg-emerald-50/40 select-all border-r">${item[keyA] || '-'}</td>
        <td class="p-2.5 font-semibold text-slate-800">${item[keyB] || '-'}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function openAddAssetModal() {
  if (!isOfficer) return;
  document.getElementById('addAssetModal')?.classList.remove('hidden');
  const dInput = document.getElementById('add_department');
  if (dInput) {
    dInput.value = currentDepartment;
    dInput.readOnly = (currentDepartment !== "ส่วนยุทธศาสตร์พื้นที่สีเขียว");
  }
}

function closeAddAssetModal() { 
  document.getElementById('addAssetModal')?.classList.add('hidden'); 
  document.getElementById('addEquipmentForm').reset(); 
  removeImagePreview('preview_add_image_box', 'preview_add_image', ['addImageCapture', 'addImageFile']);
  removeImagePreview('preview_add_qr_box', 'preview_add_qr', ['addQrCapture', 'addQrFile']);
}

function triggerEditAsset() {
  if (!currentActiveItemRaw) return;
  document.getElementById('edit_id').value = currentActiveItemRaw.ID;
  document.getElementById('edit_type').value = currentActiveItemRaw['ประเภททรัพย์สิน'] || '03 สิ่งก่อสร้าง';
  document.getElementById('edit_assetNo').value = currentActiveItemRaw['เลขทะเบียนทรัพย์สิน'] || '';
  document.getElementById('edit_name').value = currentActiveItemRaw['ชื่อทรัพย์สิน'] || currentActiveItemRaw.Name || '';
  document.getElementById('edit_status').value = currentActiveItemRaw.Status || 'ปกติ';
  document.getElementById('edit_department').value = currentActiveItemRaw['หน่วยงาน'] || '';
  document.getElementById('edit_location').value = currentActiveItemRaw['ที่ตั้ง'] || '';
  document.getElementById('edit_lat').value = currentActiveItemRaw.Lat || '';
  document.getElementById('edit_lng').value = currentActiveItemRaw.Lng || '';
  document.getElementById('edit_note').value = currentActiveItemRaw.Note || '';

  // 🟢 เพิ่มการดึงค่า 4 ฟิลด์ข้อมูลทางเทคนิคมาใส่ในฟอร์มแก้ไข
  if (document.getElementById('edit_controlBox')) {
    document.getElementById('edit_controlBox').value = currentActiveItemRaw['ตู้ควบคุม_เบรกเกอร์'] || currentActiveItemRaw['ตู้ควบคุม/เบรกเกอร์'] || currentActiveItemRaw.controlBox || '';
  }
  if (document.getElementById('edit_lampType')) {
    document.getElementById('edit_lampType').value = currentActiveItemRaw['หลอดไฟที่ติดตั้ง'] || currentActiveItemRaw.lampType || '';
  }
  if (document.getElementById('edit_wireSize')) {
    document.getElementById('edit_wireSize').value = currentActiveItemRaw['ขนาดสายไฟ'] || currentActiveItemRaw.wireSize || '';
  }
  if (document.getElementById('edit_extraTech')) {
    document.getElementById('edit_extraTech').value = currentActiveItemRaw['ข้อมูลเทคนิคอื่นๆ'] || currentActiveItemRaw['อื่นๆ'] || currentActiveItemRaw.extraTech || '';
  }

  document.getElementById('editAssetModal')?.classList.remove('hidden');
}

function closeEditAssetModal() { 
  document.getElementById('editAssetModal')?.classList.add('hidden'); 
  removeImagePreview('preview_edit_image_box', 'preview_edit_image', ['editImageCapture', 'editImageFile']);
  removeImagePreview('preview_edit_qr_box', 'preview_edit_qr', ['editQrCapture', 'editQrFile']);
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('addSubmitBtn');
  btn.disabled = true;
  btn.innerText = "⏳ กำลังบันทึกข้อมูล...";

  const data = {
    type: form.type.value, 
    assetNo: form.assetNo.value, 
    name: form.name.value,
    department: form.department.value, 
    location: form.location.value,
    lat: form.lat.value, 
    lng: form.lng.value, 
    status: form.status.value,
    note: form.note.value || '', 
    // 🟢 ส่งข้อมูลทางเทคนิคเพิ่มเติม 4 รายการ
    controlBox: form.controlBox ? form.controlBox.value : '',
    lampType: form.lampType ? form.lampType.value : '',
    wireSize: form.wireSize ? form.wireSize.value : '',
    extraTech: form.extraTech ? form.extraTech.value : '',
    imageFile: compressedImageMap['addImageFile'] || null, 
    qrCodeFile: compressedImageMap['addQrFile'] || null
  };

  try {
    const res = await apiPost('saveEquipment', data);
    btn.disabled = false;
    btn.innerText = "บันทึกข้อมูลเข้าฐานระบบ";
    showQuietAlert(res.message);
    if (res.success) { closeAddAssetModal(); loadMarkers(); }
  } catch (err) {
    btn.disabled = false;
    showQuietAlert("❌ บันทึกล้มเหลว");
  }
}

async function handleEditFormSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('editSubmitBtn');
  btn.disabled = true;
  btn.innerText = "⏳ กำลังบันทึกข้อมูล...";

  const sendData = {
    id: document.getElementById('edit_id').value,
    type: document.getElementById('edit_type').value,
    assetNo: document.getElementById('edit_assetNo').value,
    name: document.getElementById('edit_name').value,
    status: document.getElementById('edit_status').value,
    department: document.getElementById('edit_department').value,
    location: document.getElementById('edit_location').value,
    lat: document.getElementById('edit_lat').value,
    lng: document.getElementById('edit_lng').value,
    note: document.getElementById('edit_note').value,
    // 🟢 ดึงข้อมูลทางเทคนิค 4 ฟิลด์ใหม่ไปอัปเดต
    controlBox: document.getElementById('edit_controlBox')?.value || '',
    lampType: document.getElementById('edit_lampType')?.value || '',
    wireSize: document.getElementById('edit_wireSize')?.value || '',
    extraTech: document.getElementById('edit_extraTech')?.value || '',
    imageFile: compressedImageMap['editImageFile'] || null, 
    qrCodeFile: compressedImageMap['editQrFile'] || null
  };

  try {
    const res = await apiPost('updateEquipment', sendData);
    btn.disabled = false;
    btn.innerText = "💾 บันทึกแก้ไขโครงสร้างข้อมูล";
    showQuietAlert(res.message);
    if (res.success) { 
      closeEditAssetModal(); 
      closeModal(); 
      loadMarkers(); 
    }
  } catch(err) {
    btn.disabled = false;
    showQuietAlert("❌ แก้ไขล้มเหลว");
  }
}

function getCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      document.getElementById('formLat').value = p.coords.latitude.toFixed(6);
      document.getElementById('formLng').value = p.coords.longitude.toFixed(6);
      showQuietAlert("🎯 ดึงพิกัดดาวเทียมสำเร็จ");
    });
  }
}

function handleNativeImage(input, previewImgId, companionInputId) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    compressImage(file, base64 => {
      const previewEl = document.getElementById(previewImgId);
      const previewBox = document.getElementById(previewImgId + '_box');
      if (previewEl && previewBox) {
        previewEl.src = base64;
        previewBox.classList.remove('hidden');
      }

      const key = input.id.includes('Capture') ? input.id.replace('Capture', 'File') : input.id;
      compressedImageMap[key] = {
        base64: base64,
        name: file.name || `photo_${Date.now()}.jpg`,
        type: "image/jpeg"
      };

      const companion = document.getElementById(companionInputId);
      if (companion) companion.value = '';
    });
  }
}

function removeImagePreview(boxId, imgId, inputIds) {
  document.getElementById(boxId)?.classList.add('hidden');
  const img = document.getElementById(imgId);
  if (img) img.src = '';
  if (Array.isArray(inputIds)) {
    inputIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
      const key = id.includes('Capture') ? id.replace('Capture', 'File') : id;
      delete compressedImageMap[key];
    });
  }
}

function compressImage(file, callback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = e => {
    const img = new Image();
    img.src = e.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > 1024) { height = Math.round((height * 1024) / width); width = 1024; }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.7));
    };
  };
}

function exportToCSV(filename, headers, rowsData, mapperFn) {
  if (!rowsData || rowsData.length === 0) {
    showQuietAlert("⚠️ ไม่มีข้อมูลสำหรับส่งออก CSV");
    return;
  }
  let csvContent = "\uFEFF" + headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
  rowsData.forEach(item => {
    const rowCells = mapperFn(item);
    csvContent += rowCells.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(",") + "\r\n";
  });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  showQuietAlert("✅ ส่งออกรายงาน CSV เรียบร้อยแล้ว");
}

function exportMasterCSV() {
  const data = masterDisplayList.length > 0 ? masterDisplayList : masterFilteredList;
  exportToCSV('ตารางรายละเอียดทรัพย์สิน.csv', ['ดัชนีทรัพย์สิน (ID)', 'ชื่อครุภัณฑ์ทรัพย์สิน', 'เลขทะเบียนทรัพย์สิน', 'หน่วยงานรับผิดชอบ', 'สถานที่ / ที่ตั้งหลัก', 'จำนวนครั้งแจ้งซ่อมสะสม', 'สถานะ'], data, item => [
    item.ID, item['ชื่อทรัพย์สิน'] || item.Name, item['เลขทะเบียนทรัพย์สิน'] || '-', item['หน่วยงาน'] || '-', item['ที่ตั้ง'] || '-', (globalReportCounts[item.ID] || 0) + ' ครั้ง', item.Status || 'ปกติ'
  ]);
}

function exportSuccessCSV() {
  exportToCSV('ประวัติงานซ่อมบำรุงเสร็จสิ้น.csv', ['วันที่บันทึกซ่อมเสร็จ', 'เลขที่ใบงาน', 'ID ครุภัณฑ์', 'แจ้งซ่อมสะสม', 'รายละเอียดบันทึกกิจกรรมซ่อมบำรุง', 'ช่างผู้ซ่อมบำรุง', 'หน่วยงาน', 'สถานที่'], successListGlobal, item => [
    item.date, item.repairId, item.assetId, (item.totalReports || 0) + ' ครั้ง', item.details, item.reporter, item.department, item.location
  ]);
}

function exportDamagedCSV() {
  const damagedList = allData.filter(x => (x.Status || x.status || '').toString().trim() === 'ชำรุด');
  exportToCSV('รายการงานชำรุดคงค้าง.csv', ['ID ครุภัณฑ์ชำรุด', 'ชื่อครุภัณฑ์อุปกรณ์', 'เลขทะเบียนทรัพย์สิน', 'หน่วยงานผู้ดูแล', 'สถานที่ติดตั้ง'], damagedList, item => [
    item.ID, item['ชื่อทรัพย์สิน'] || item.Name, item['เลขทะเบียนทรัพย์สิน'] || '-', item['หน่วยงาน'] || '-', item['ที่ตั้ง'] || '-'
  ]);
}

function downloadQRCode() {
  const qrImg = document.getElementById('wsUploadedQr');
  if (qrImg && qrImg.src && qrImg.src.includes('http')) {
    const link = document.createElement('a');
    link.href = qrImg.src;
    link.target = "_blank";
    link.download = `QR_${currentActiveId}.png`;
    link.click();
  }
}

function openAuthModal() { document.getElementById('authModal')?.classList.remove('hidden'); document.getElementById('officerPassword').focus(); }
function closeAuthModal() { document.getElementById('authModal')?.classList.add('hidden'); document.getElementById('authForm').reset(); }

async function handleAuthSubmit(e) {
  e.preventDefault();
  const pass = document.getElementById('officerPassword').value;
  showLoadingModal("🔒 กำลังตรวจสอบสิทธิ์...", "กรุณารอสักครู่");

  try {
    const res = await apiGet('verifyUserCode', { code: pass });
    hideLoadingModal();
    if (res && res.success) {
      isOfficer = (res.role === "admin" || res.role === "officer");
      isTechnician = (res.role === "technician");
      isAdmin = (res.role === "admin");
      currentDepartment = res.dept;

      // 🟢 บันทึกสิทธิ์ผู้ใช้งานเข้าระบบสำหรับเปิดการ์ดข้อมูลเทคนิค (Modal & PDF)
      window.userRole = res.role;
      sessionStorage.setItem('userRole', res.role);
      localStorage.setItem('userRole', res.role);

      document.getElementById('logoutBtn')?.classList.remove('hidden');
      document.getElementById('authBtn')?.classList.add('hidden');

      if (isOfficer) {
        document.getElementById('authSuccessBadge').innerText = (isAdmin ? "● ผู้ดูแลระบบ: " : "● ") + res.dept;
        document.getElementById('authSuccessBadge').classList.remove('hidden');
        document.getElementById('addAssetBtnNav').classList.remove('hidden');
        document.getElementById('masterInventoryContainer').classList.remove('hidden');
      } else if (isTechnician) {
        document.getElementById('techSuccessBadge').innerText = "● " + res.dept;
        document.getElementById('techSuccessBadge').classList.remove('hidden');
        document.getElementById('damagedAssetsContainer').classList.remove('hidden');
        document.getElementById('estimateAssetsContainer').classList.remove('hidden');
        document.getElementById('successAssetsContainer').classList.remove('hidden');
      }

      closeAuthModal();
      loadMarkers(pass);
      updateDashboardLayout(true);
      showQuietAlert("🔓 เปิดสิทธิ์ใช้งานสำเร็จ: " + res.dept);
    } else {
      showQuietAlert("❌ " + (res ? res.message : "รหัสผ่านไม่ถูกต้อง"));
    }
  } catch(err) {
    hideLoadingModal();
    showQuietAlert("❌ ตรวจสอบสิทธิ์ล้มเหลว");
  }
}

function handleLogout() {
  isOfficer = false; isTechnician = false; isAdmin = false; currentDepartment = ""; currentUserCode = "";
  document.getElementById('authSuccessBadge')?.classList.add('hidden');
  document.getElementById('techSuccessBadge')?.classList.add('hidden');
  document.getElementById('addAssetBtnNav')?.classList.add('hidden');
  document.getElementById('logoutBtn')?.classList.add('hidden');
  document.getElementById('authBtn')?.classList.remove('hidden');
  document.getElementById('damagedAssetsContainer')?.classList.add('hidden');
  document.getElementById('estimateAssetsContainer')?.classList.add('hidden');
  document.getElementById('successAssetsContainer')?.classList.add('hidden');
  document.getElementById('masterInventoryContainer')?.classList.add('hidden');

  closeModal();
  updateDashboardLayout(false);
  loadMarkers("");
  showQuietAlert("🔒 ออกจากระบบเรียบร้อย");
}

function updateDashboardLayout(loggedIn) {
  const grid = document.getElementById('mainDashboardGrid');
  const mapWrapper = document.getElementById('mapWrapper');
  const tablesWrapper = document.getElementById('tablesWrapper');

  if (loggedIn) {
    grid.classList.remove('grid-cols-1');
    grid.classList.add('lg:grid-cols-12');
    mapWrapper.classList.remove('lg:col-span-12');
    mapWrapper.classList.add('lg:col-span-5', 'xl:col-span-5');
    tablesWrapper.classList.remove('hidden');
    tablesWrapper.classList.add('lg:col-span-7', 'xl:col-span-7');
  } else {
    grid.classList.remove('lg:grid-cols-12');
    grid.classList.add('grid-cols-1');
    mapWrapper.classList.remove('lg:col-span-5', 'xl:col-span-5');
    mapWrapper.classList.add('lg:col-span-12');
    tablesWrapper.classList.add('hidden');
    tablesWrapper.classList.remove('lg:col-span-7', 'xl:col-span-7');
  }
  setTimeout(() => { if (map) map.invalidateSize(); }, 350);
}

function openImageModal(imgUrl) {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalTargetImg');
  if (modal && img) { img.src = imgUrl; modal.classList.remove('hidden'); }
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalTargetImg');
  if (modal && img) { modal.classList.add('hidden'); img.src = ""; }
}

function showQuietAlert(msg) {
  const box = document.getElementById('quietAlertContainer');
  if (box) {
    document.getElementById('quietAlertText').innerText = msg;
    box.classList.add('show');
    setTimeout(() => box.classList.remove('show'), 4000);
  }
}

function showLoadingModal(title, sub) {
  const modal = document.getElementById('loadingModal');
  if (modal) {
    document.getElementById('loadingModalTitle').innerText = title || "กำลังบันทึกข้อมูล...";
    document.getElementById('loadingModalSub').innerText = sub || "กรุณารอสักครู่";
    modal.classList.remove('hidden');
  }
}

function hideLoadingModal() { document.getElementById('loadingModal')?.classList.add('hidden'); }

// ==========================================
// 📄 ฟังก์ชัน Export PDF (A4) - คลี่ประวัติครบทุกรายการ + ดึงข้อมูลคลุมทุกกรณี
// ==========================================
function generatePdfReport(equipId) {
  // 1. ดึง ID ครุภัณฑ์ (รองรับทั้งส่งพารามิเตอร์มา หรือใช้ตัวแปร Active ในระบบ)
  const targetId = equipId || (typeof currentActiveId !== 'undefined' ? currentActiveId : null);
  
  if (!targetId) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบรหัสครุภัณฑ์สำหรับสร้างรายงาน");
    return;
  }

  // 2. ดึงข้อมูลครุภัณฑ์แบบค้นหาครอบคลุมทุกที่เก็บข้อมูล
  const allAssets = window.allAssetsData || window.equipmentData || [];
  let item = allAssets.find(x => x && (x.ID || x.id || '').toString().trim().toUpperCase() === targetId.toString().trim().toUpperCase());
  
  if (!item && typeof window.currentActiveAssetData !== 'undefined') {
    item = window.currentActiveAssetData;
  }

  // หากยังหาไม่พบ ให้สร้าง object fallback เพื่อไม่ให้ระบบค้างชะงัก
  if (!item) {
    item = {
      ID: targetId,
      name: document.getElementById('wsTitle')?.innerText || 'ไม่ระบุชื่อครุภัณฑ์',
      assetNo: '-',
      department: '-',
      location: '-',
      status: '-'
    };
  }

  if (typeof showQuietAlert === 'function') showQuietAlert("⏳ กำลังคลี่ประวัติและจัดหน้าเอกสาร PDF (A4)...");

  // 3. ดึงประวัติการซ่อมบำรุงทั้งหมด
  const allHistory = window.allRepairHistoryData || window.repairHistoryData || [];
  const historyList = allHistory.filter(h => h && h.assetId && h.assetId.toString().trim().toUpperCase() === targetId.toString().trim().toUpperCase());

  // 4. สร้างแผ่นรายงาน A4 แบบขยายพื้นที่ (ไม่จำกัด Max-Height / คลี่ทุกการบันทึก)
  const printDoc = document.createElement('div');
  printDoc.style.width = '790px';
  printDoc.style.padding = '20px';
  printDoc.style.backgroundColor = '#ffffff';
  printDoc.style.color = '#1e293b';
  printDoc.style.fontFamily = 'Garuda, Thonburi, Tahoma, sans-serif';
  printDoc.style.boxSizing = 'border-box';
  printDoc.style.position = 'absolute';
  printDoc.style.left = '-9999px';

  // โครงสร้างประวัติย่อยแต่ละรายการ ( Render เต็มทุกขั้นตอน 1, 2, 3 )
  let historyHtml = historyList.map((h, idx) => `
    <div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:10px; background-color:#f8fafc; page-break-inside:avoid;">
      <div style="font-weight:bold; color:#065f46; font-size:12px; margin-bottom:4px;">
        📌 ใบงานที่ ${idx + 1}: ${h.repairId || '-'} <span style="color:#64748b; font-weight:normal;">(${h.date || '-'})</span>
      </div>
      <div style="font-size:11px; color:#334155; line-height:1.4;">
        <b>รายละเอียดแจ้งซ่อม:</b> ${h.details || '-'}<br/>
        <b>ผู้แจ้ง:</b> ${h.reporter || '-'} | <b>สถานะ:</b> <b style="color:#059669;">${h.status || '-'}</b>
      </div>
    </div>
  `).join('');

  if (historyList.length === 0) {
    historyHtml = '<div style="text-align:center; color:#94a3b8; padding:15px; font-size:11px;">ไม่มีบันทึกประวัติการแจ้งซ่อมในระบบ</div>';
  }

  printDoc.innerHTML = `
    <div style="text-align:center; border-bottom:2px double #059669; padding-bottom:5px; margin-bottom:12px;">
      <h3 style="margin:0; color:#065f46; font-size:18px;">รายงานประวัติและทะเบียนครุภัณฑ์ประจำพิกัด</h3>
      <span style="font-size:11px; color:#64748b;">รหัสครุภัณฑ์: ${item.ID || item.id} | วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH')}</span>
    </div>
    
    <div style="margin-bottom:15px; font-size:12px; line-height:1.5;">
      <b>ชื่อครุภัณฑ์:</b> ${item['ชื่อทรัพย์สิน'] || item.name || '-'}<br/>
      <b>เลขทะเบียน:</b> ${item['เลขทะเบียนทรัพย์สิน'] || item.assetNo || '-'} | <b>สถานที่:</b> ${item['ที่ตั้ง'] || item.location || '-'}
    </div>

    <div style="font-weight:bold; font-size:13px; color:#0f172a; margin-bottom:8px; border-left:4px solid #059669; padding-left:6px;">
      📜 รายการประวัติไทม์ไลน์การซ่อมบำรุงทั้งหมด (${historyList.length} รายการ)
    </div>

    <div>${historyHtml}</div>
  `;

  document.body.appendChild(printDoc);

  // 5. ส่งออกไฟล์ PDF ด้วย html2pdf
  const opt = {
    margin:       [8, 8, 8, 8],
    filename:     `Report_${targetId}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, scrollY: 0 },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(printDoc).save().then(() => {
    document.body.removeChild(printDoc);
    if (typeof showQuietAlert === 'function') showQuietAlert("✅ Export PDF รายงานสำเร็จเรียบร้อย");
  }).catch(err => {
    if (document.body.contains(printDoc)) document.body.removeChild(printDoc);
    if (typeof showQuietAlert === 'function') showQuietAlert("❌ ออก PDF ไม่สำเร็จ: " + err.toString());
  });
}

// ==========================================
// 📄 1. ฟังก์ชันปุ่ม Export PDF (A4) - เปิด Window ทันทีเพื่อแก้ Pop-up Block
// ==========================================
function triggerExportPDF() {
  const targetId = currentActiveId || (currentActiveItemRaw ? currentActiveItemRaw.ID : null);
  if (!targetId) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบรหัสครุภัณฑ์สำหรับสร้างรายงาน");
    return;
  }

  // 🟢 เปิด window ทันทีที่คลิก เพื่อป้องกัน Pop-up Blocker บล็อกหน้าต่าง
  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ กรุณาอนุญาต Pop-up ในเบราว์เซอร์เพื่อเปิดหน้าพิมพ์");
    return;
  }
  
  printWindow.document.write("<!DOCTYPE html><html><head><title>กำลังเตรียมรายงาน...</title></head><body style='font-family:sans-serif;text-align:center;padding-top:60px;color:#475569;'><h3>⏳ กำลังโหลดข้อมูลรายงานและเตรียมหน้าเอกสาร...</h3></body></html>");

  generateA4ReportPDFClient(targetId, printWindow);
}

// ==========================================
// 📄 ฟังก์ชันพิมพ์ PDF รายงาน A4 (ดึงข้อมูลเทคนิคครบทุกชื่อคอลัมน์)
// ==========================================
async function generateA4ReportPDFClient(equipId, printWindow) {
  const allAssets = (typeof allData !== 'undefined' && allData.length > 0) ? allData : (window.allAssetsData || []);
  let item = allAssets.find(x => x && (x.ID || x.id || '').toString().trim().toUpperCase() === String(equipId).trim().toUpperCase());

  if (!item && typeof currentActiveItemRaw !== 'undefined' && currentActiveItemRaw) {
    item = currentActiveItemRaw;
  }

  if (!item) {
    if (printWindow) printWindow.close();
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบข้อมูลครุภัณฑ์สำหรับสร้างรายงาน");
    return;
  }

  // 🔒 ตรวจสอบสิทธิ์ผู้ใช้งาน
  const currentRole = window.userRole || sessionStorage.getItem('userRole') || localStorage.getItem('userRole') || '';
  const isAuthorizedTech = (typeof isAdmin !== 'undefined' && isAdmin) ||
                           (typeof isTechnician !== 'undefined' && isTechnician) ||
                           (currentRole === 'admin' || currentRole === 'technician');

  // ดึงข้อมูลเทคนิค
  const controlBox = item['ตู้ควบคุม/เบรกเกอร์'] || item['ตู้ควบคุม_เบรกเกอร์'] || item.controlBox || item['ตู้ควบคุม'] || '';
  const lampType = item['หลอดไฟที่ติดตั้ง'] || item.lampType || item['หลอดไฟ'] || '';
  const wireSize = item['ขนาดสายไฟ'] || item.wireSize || '';
  const extraTech = item['ข้อมูลเทคนิคอื่นๆ'] || item['อื่นๆ'] || item.extraTech || '';

  let techSpecsSectionHtml = '';
  if (isAuthorizedTech) {
    techSpecsSectionHtml = `
      <div class="section-title" style="border-left-color: #0284c7; color: #0369a1;">⚡ ข้อมูลคุณลักษณะทางเทคนิคเฉพาะ (สิทธิ์ Admin & Technician)</div>
      <table style="margin-bottom: 12px; font-size: 11.5px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;">
        <tr style="border-bottom: 1px dashed #cbd5e1;">
          <td width="50%" style="padding:6px;"><b>🗄️ ตู้ควบคุม / เบรกเกอร์:</b> ${controlBox || '-'}</td>
          <td width="50%" style="padding:6px;"><b>💡 หลอดไฟที่ติดตั้ง:</b> ${lampType || '-'}</td>
        </tr>
        <tr>
          <td style="padding:6px;"><b>🔌 ขนาดสายไฟ:</b> ${wireSize || '-'}</td>
          <td style="padding:6px;"><b>📝 อื่นๆ ระบุ:</b> ${extraTech || '-'}</td>
        </tr>
      </table>
    `;
  }

  // ดึงประวัติซ่อมบำรุง
  let historyList = [];
  const searchKey = String(equipId).trim().toUpperCase();
  
  try {
    const res = await apiGet('getRepairHistory');
    if (res && res.success && Array.isArray(res.data)) {
      historyList = res.data.filter(h => h && h.assetId && String(h.assetId).trim().toUpperCase() === searchKey);
    }
  } catch (e) {
    const memoryCache = window.allRepairHistoryData || window.repairHistoryData || [];
    historyList = memoryCache.filter(h => h && h.assetId && String(h.assetId).trim().toUpperCase() === searchKey);
  }

  // 🟢 ถอดรหัสข้อความ OP_TYPE ออกเป็นรูปแบบไทม์ไลน์อ่านง่ายลงในตาราง PDF
  let historyRowsHtml = '';
  if (historyList.length > 0) {
    historyRowsHtml = historyList.map(h => {
      let statusColor = h.status === 'ซ่อมเสร็จสิ้น' ? '#059669' : (h.status === 'รอจัดจ้าง' ? '#d97706' : '#dc2626');
      
      let fullText = h.details || '';
      let initialReportText = fullText;
      let techLogText = '';
      let materialsText = '';
      let contractText = '';

      if (fullText.includes('[บันทึกจัดจ้าง]:')) {
        const parts = fullText.split('[บันทึกจัดจ้าง]:');
        fullText = parts[0].trim();
        contractText = parts[1].trim();
      }

      if (fullText.includes('[ช่างบันทึก]:')) {
        const parts = fullText.split('[ช่างบันทึก]:');
        initialReportText = parts[0].trim();
        techLogText = parts[1].trim();
      } else if (fullText.includes('OP_TYPE:')) {
        techLogText = fullText;
        initialReportText = 'แจ้งซ่อมผ่านระบบ';
      }

      if (techLogText.includes('OP_TYPE:')) {
        const opParts = techLogText.split('##');
        let detailsVal = '', typeVal = '';
        opParts.forEach(p => {
          if (p.startsWith('OP_TYPE:')) typeVal = p.replace('OP_TYPE:', '');
          if (p.startsWith('DETAILS:')) detailsVal = p.replace('DETAILS:', '');
          if (p.startsWith('MATERIALS:')) materialsText = p.replace('MATERIALS:', '');
        });
        techLogText = `[${typeVal}] ${detailsVal}`;
      }

      // สร้างข้อความแยกบรรทัดแสดงขั้นตอนใน PDF
      let formattedDetailsHtml = `<div style="line-height:1.4;">`;
      formattedDetailsHtml += `<div><b>1. แจ้งซ่อม:</b> ${initialReportText}</div>`;
      if (techLogText) {
        formattedDetailsHtml += `<div style="margin-top:2px; color:#1e3a8a;"><b>2. ผลงานช่าง:</b> ${techLogText}</div>`;
      }
      if (materialsText) {
        formattedDetailsHtml += `<div style="margin-top:1px; color:#475569; font-size:10px;"><b>📦 วัสดุอุปกรณ์ที่ใช้:</b> ${materialsText}</div>`;
      }
      if (contractText) {
        formattedDetailsHtml += `<div style="margin-top:2px; color:#065f46;"><b>3. งานสัญญาจัดจ้าง:</b> ${contractText}</div>`;
      }
      formattedDetailsHtml += `</div>`;

      return `<tr>
        <td style="padding:6px; border:1px solid #cbd5e1; text-align:center; font-size:11px;">${h.date || '-'}<br/><b style="color:#64748b; font-size:10px;">${h.repairId || ''}</b></td>
        <td style="padding:6px; border:1px solid #cbd5e1; font-size:11px;">${formattedDetailsHtml}</td>
        <td style="padding:6px; border:1px solid #cbd5e1; text-align:center; font-weight:bold; color:${statusColor}; font-size:11px;">${h.status || '-'}</td>
        <td style="padding:6px; border:1px solid #cbd5e1; font-size:11px;">${h.reporter || '-'}</td>
      </tr>`;
    }).join('');
  } else {
    historyRowsHtml = `<tr><td colspan="4" style="padding:12px; border:1px solid #cbd5e1; text-align:center; color:#94a3b8; font-size:11px;">ไม่มีประวัติการแจ้งซ่อมในระบบ</td></tr>`;
  }

  const assetImgSrc = item.Image || item.image || document.getElementById('wsImg')?.src || '';
  const qrImgSrc = item.QRCode || item.qrCode || document.getElementById('wsUploadedQr')?.src || '';
  const assetImgTag = (assetImgSrc && !assetImgSrc.includes('data:,')) ? `<img src="${assetImgSrc}" style="max-height:160px; max-width:100%; object-fit:contain; border-radius:6px;"/>` : '<p style="color:#94a3b8; font-size:11px;">(ไม่มีภาพถ่ายประกอบ)</p>';
  const qrImgTag = (qrImgSrc && !qrImgSrc.includes('data:,')) ? `<img src="${qrImgSrc}" style="max-height:130px; max-width:100%; object-fit:contain; border-radius:6px;"/>` : '<p style="color:#94a3b8; font-size:11px;">(ไม่มี QR Code)</p>';

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>รายงานทะเบียนประวัติครุภัณฑ์_${item.ID || equipId}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { font-family: "Sarabun", "Garuda", Tahoma, sans-serif; color: #1e293b; margin: 0; padding: 0; background: #fff; }
        table { width: 100%; border-collapse: collapse; }
        .page-header { text-align: center; border-bottom: 2px double #059669; padding-bottom: 6px; margin-bottom: 12px; }
        .section-title { font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 10px; margin-bottom: 6px; border-left: 4px solid #059669; padding-left: 8px; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="page-header">
        <h2 style="font-size: 18px; font-weight: bold; color: #065f46; margin: 0 0 4px 0;">รายงานข้อมูลคุณลักษณะและทะเบียนประวัติครุภัณฑ์ประจำพิกัด</h2>
        <p style="font-size: 11px; color: #64748b; margin: 0;">รหัสอ้างอิง: ${item.ID || item.id || '-'} | วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH')}</p>
      </div>

      <table style="margin-bottom: 12px;">
        <tr>
          <td width="68%" style="text-align:center; background-color:#f8fafc; padding:8px; border:1px solid #e2e8f0; border-radius:8px; vertical-align:middle;">
            <b style="font-size:11px; color:#334155;">📷 ภาพถ่ายจุดติดตั้งครุภัณฑ์ปัจจุบัน</b><br/><br/>${assetImgTag}
          </td>
          <td width="2%"></td>
          <td width="30%" style="text-align:center; background-color:#f8fafc; padding:8px; border:1px solid #e2e8f0; border-radius:8px; vertical-align:middle;">
            <b style="font-size:11px; color:#334155;">🔗 QR Code เพิ่มเติม</b><br/><br/>${qrImgTag}
          </td>
        </tr>
      </table>

      <div class="section-title">📝 ข้อมูลผังทะเบียนคุณลักษณะครุภัณฑ์หลัก</div>
      <table style="margin-bottom: 12px; font-size: 12px;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td width="50%" style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">ดัชนีทรัพย์สิน</span><br/><b style="font-size:14px; color:#0f172a;">${item.ID || item.id || '-'}</b></td>
          <td width="50%" style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">ประเภททรัพย์สิน</span><br/><span style="font-size:13px; color:#0f172a;">${item['ประเภททรัพย์สิน'] || item.type || '-'}</span></td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">เลขทะเบียนทรัพย์สิน</span><br/><span style="font-size:13px; color:#0f172a;">${item['เลขทะเบียนทรัพย์สิน'] || item.assetNo || '-'}</span></td>
          <td style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">ชื่อครุภัณฑ์ทรัพย์สิน</span><br/><b style="font-size:13px; color:#0f172a;">${item['ชื่อทรัพย์สิน'] || item.Name || item.name || '-'}</b></td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">หน่วยงานผู้รับผิดชอบ</span><br/><span style="font-size:13px; color:#0f172a;">${item['หน่วยงาน'] || item.department || '-'}</span></td>
          <td style="padding:5px;"><span style="font-size:10px; color:#64748b; font-weight:bold;">สถานที่ติดตั้งหลัก</span><br/><b style="font-size:13px; color:#065f46;">📍 ${item['ที่ตั้ง'] || item.location || '-'}</b></td>
        </tr>
      </table>

      ${techSpecsSectionHtml}

      <div class="section-title">📜 บันทึกประวัติ ไทม์ไลน์แจ้งซ่อม และสรุปสัญญาจัดจ้างย้อนหลัง</div>
      <table style="font-size:11px;">
        <thead>
          <tr style="background-color:#f1f5f9; color:#334155;">
            <th width="18%" style="padding:6px; border:1px solid #cbd5e1; text-align:center;">วันที่ / เลขใบงาน</th>
            <th width="52%" style="padding:6px; border:1px solid #cbd5e1; text-align:center;">รายละเอียดบันทึกกิจกรรมซ่อมบำรุง</th>
            <th width="15%" style="padding:6px; border:1px solid #cbd5e1; text-align:center;">สถานะใบงาน</th>
            <th width="15%" style="padding:6px; border:1px solid #cbd5e1; text-align:center;">ผู้เกี่ยวข้อง</th>
          </tr>
        </thead>
        <tbody>${historyRowsHtml}</tbody>
      </table>

      <script>
        window.onload = function() { setTimeout(function() { window.print(); }, 500); };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ==========================================
// 📱 2. ฟังก์ชันเรนเดอร์หน้าต่างแสดงรายละเอียด (Detail Modal UI)
// ==========================================
function renderTechSpecsDetailModal(item) {
  const container = document.getElementById('wsTechSpecsContainer');
  if (!container) return;

  const currentRole = window.userRole || sessionStorage.getItem('userRole') || localStorage.getItem('userRole') || '';
  const isAuthorizedTech = (currentRole === 'admin' || currentRole === 'technician');

  const controlBox = item['ตู้ควบคุม/เบรกเกอร์'] || item['ตู้ควบคุม_เบรกเกอร์'] || item.controlBox || '';
  const lampType = item['หลอดไฟที่ติดตั้ง'] || item.lampType || '';
  const wireSize = item['ขนาดสายไฟ'] || item.wireSize || '';
  const extraTech = item['ข้อมูลเทคนิคอื่นๆ'] || item['อื่นๆ'] || item.extraTech || '';

  if (isAuthorizedTech && (controlBox || lampType || wireSize || extraTech)) {
    container.innerHTML = `
      <div class="mt-3 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs">
        <div class="font-bold text-sky-800 mb-2 flex items-center gap-1">
          <i class="ph ph-lightning text-sm"></i> ข้อมูลเทคนิคเฉพาะ (สิทธิ์ Admin & Technician)
        </div>
        <div class="grid grid-cols-2 gap-2 text-slate-700">
          <div><b>🗄️ ตู้ควบคุม/เบรกเกอร์:</b> ${controlBox || '-'}</div>
          <div><b>💡 หลอดไฟที่ติดตั้ง:</b> ${lampType || '-'}</div>
          <div><b>🔌 ขนาดสายไฟ:</b> ${wireSize || '-'}</div>
          <div><b>📝 อื่นๆ ระบุ:</b> ${extraTech || '-'}</div>
        </div>
      </div>
    `;
    container.classList.remove('hidden');
  } else {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}

// ==========================================
// 📦 2. ฟังก์ชันออก "ใบเบิกวัสดุ/อุปกรณ์ซ่อมบำรุง" (รูปแบบ Native Print A4)
// ==========================================
function printWithdrawalForm(repairData) {
  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ กรุณาอนุญาต Pop-up ในเบราว์เซอร์เพื่อเปิดใบเบิก");
    return;
  }

  const r = repairData || {};
  const repairId = r.repairId || r.ID || '-';
  const assetId = r.assetId || r.equipId || '-';
  const assetName = r.assetName || r.name || '-';
  const department = r.department || 'สำนักสิ่งแวดล้อม';
  const location = r.location || '-';
  const requester = r.reporter || r.requester || '-';
  const dateStr = r.date || new Date().toLocaleDateString('th-TH');

  // แกะรายการวัสดุอุปกรณ์จากข้อความบันทึก
  let rawMaterials = r.materials || '';
  if (!rawMaterials && r.details && r.details.includes('MATERIALS:')) {
    rawMaterials = r.details.split('MATERIALS:')[1].split('##')[0];
  }

  let materialItems = rawMaterials.split(',').filter(m => m.trim() !== '');
  let materialRowsHtml = materialItems.map((mat, index) => {
    return `
      <tr>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">${index + 1}</td>
        <td style="padding:8px; border:1px solid #94a3b8;">${mat.trim()}</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">1</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">ชุด/รายการ</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">เพื่อซ่อมบำรุง</td>
      </tr>
    `;
  }).join('');

  if (materialItems.length === 0) {
    materialRowsHtml = `
      <tr>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">1</td>
        <td style="padding:8px; border:1px solid #94a3b8;">${rawMaterials || 'วัสดุอุปกรณ์ซ่อมบำรุงทั่วไป'}</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">1</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">ชุด</td>
        <td style="padding:8px; border:1px solid #94a3b8; text-align:center;">เบิกตามใบงาน</td>
      </tr>
    `;
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบเบิกวัสดุอุปกรณ์_${repairId}</title>
      <style>
        @page { size: A4 portrait; margin: 15mm; }
        body { font-family: "Sarabun", "Garuda", Tahoma, sans-serif; color: #0f172a; margin: 0; padding: 0; background: #fff; }
        table { width: 100%; border-collapse: collapse; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h1 { font-size: 20px; font-weight: bold; margin: 0 0 5px 0; color: #065f46; }
        .header p { font-size: 13px; margin: 0; color: #475569; }
        .info-box { font-size: 13px; margin-bottom: 15px; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; }
        .sign-table { margin-top: 40px; font-size: 12px; }
        .sign-box { text-align: center; padding: 10px; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>ใบเบิกวัสดุ / อุปกรณ์ซ่อมบำรุงครุภัณฑ์</h1>
        <p>หน่วยงาน: ${department}</p>
      </div>

      <div class="info-box">
        <table>
          <tr>
            <td width="60%"><b>เลขที่ใบแจ้งซ่อม:</b> ${repairId}</td>
            <td width="40%"><b>วันที่เบิก:</b> ${dateStr}</td>
          </tr>
          <tr>
            <td><b>รหัสครุภัณฑ์:</b> ${assetId} (${assetName})</td>
            <td><b>สถานที่ติดตั้ง:</b> ${location}</td>
          </tr>
          <tr>
            <td colspan="2"><b>ผู้ขอเบิก / ช่างผู้รับผิดชอบ:</b> ${requester}</td>
          </tr>
        </table>
      </div>

      <b style="font-size: 13px;">รายการวัสดุอุปกรณ์ที่ขอเบิก:</b>
      <table style="margin-top: 8px; font-size: 12px;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th width="10%" style="padding:8px; border:1px solid #94a3b8; text-align:center;">ลำดับ</th>
            <th width="50%" style="padding:8px; border:1px solid #94a3b8; text-align:center;">รายการวัสดุ / อุปกรณ์</th>
            <th width="12%" style="padding:8px; border:1px solid #94a3b8; text-align:center;">จำนวน</th>
            <th width="13%" style="padding:8px; border:1px solid #94a3b8; text-align:center;">หน่วยนับ</th>
            <th width="15%" style="padding:8px; border:1px solid #94a3b8; text-align:center;">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${materialRowsHtml}
        </tbody>
      </table>

      <table class="sign-table">
        <tr>
          <td class="sign-box" width="33%">
            ลงชื่อ....................................................ผู้ขอเบิก<br/>
            (....................................................)<br/>
            ตำแหน่ง....................................................
          </td>
          <td class="sign-box" width="33%">
            ลงชื่อ....................................................ผู้จ่ายวัสดุ<br/>
            (....................................................)<br/>
            ตำแหน่ง....................................................
          </td>
          <td class="sign-box" width="33%">
            ลงชื่อ....................................................ผู้อนุมัติ<br/>
            (....................................................)<br/>
            ตำแหน่ง....................................................
          </td>
        </tr>
      </table>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 500);
        };
      </script>
    </body>
    </html>
  `);

  printWindow.document.close();
}
