let map, markersLayer, allData = [], markerDict = {};
let isOfficer = false, isTechnician = false, isAdmin = false, currentDepartment = "";
let currentActiveId = "", currentActiveItemRaw = null, bmaMaskLayer = null, bmaDistrictsLayer = null, bmaCachedGeoJSON = null;
let successListGlobal = [], successListRaw = [], currentPage = 1, recordsPerPage = 25;
let masterFilteredList = [], currentMasterPage = 1, masterRecordsPerPage = 25;
let masterDisplayList = []; 
let globalReportCounts = {};
let currentUserCode = "";
let indexRawData = [], indexFilteredData = [], indexHeaders = [];

window.onload = function() { 
  initMap(); 
  loadMarkers(); 
  loadIndexData();
};

// ==========================================
// 🌐 API Bridge (Fetch Client)
// ==========================================
async function apiGet(action, params = {}) {
  const url = new URL(API_BASE_URL);
  url.searchParams.append('action', action);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  const response = await fetch(url.toString(), { method: 'GET', mode: 'cors', redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP status ${response.status}`);
  return await response.json();
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

// ==========================================
// 🗺️ Leaflet Map & BMA Overlay
// ==========================================
function initMap() {
  try {
    const streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; CartoDB'
    });
    const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20, attribution: '&copy; Google Maps'
    });

    map = L.map('map', { center: [13.745, 100.62], zoom: 11, layers: [streetLayer] });
    markersLayer = L.markerClusterGroup({ maxClusterRadius: 50, disableClusteringAtZoom: 17 });
    markersLayer.addTo(map);

    L.control.layers({ "🗺️ แผนที่ถนน": streetLayer, "🛰️ ภาพดาวเทียม": satelliteLayer }, null, { position: 'topleft' }).addTo(map);
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

function drawBMAData(data, targetLocName) {
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
      if (matchingDistrictName && dName.toString().includes(matchingDistrictName)) {
        return { color: '#059669', weight: 2.5, fillColor: '#34d399', fillOpacity: 0.15 };
      }
      return { color: '#047857', weight: 1.2, fillColor: '#10b981', fillOpacity: 0.02 };
    }
  }).addTo(map);

  const worldOuterRing = [[90, -180], [90, 180], [-90, 180], [-90, -180]];
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

  bmaMaskLayer = L.polygon(maskRings, { stroke: false, fillColor: '#0f172a', fillOpacity: 0.45, interactive: false }).addTo(map);
}

// ==========================================
// 📊 Data Loading & Dynamic Dependent Filter Logic
// ==========================================
async function loadMarkers(userCode) {
  if (userCode !== undefined) currentUserCode = userCode;
  showQuietAlert("⏳ กำลังเชื่อมต่อฐานข้อมูลคลังครุภัณฑ์...");

  try {
    const res = await apiGet('getEquipmentData', { userCode: currentUserCode });
    if (res && res.success) {
      allData = processDataSequence(res.data || []);
      updateStatisticsCounters(allData);
      
      // อัปเดต Dropdown หน่วยงานและสถานที่แบบสัมพันธ์กัน
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

function createNumberedIcon(text, status) {
  let borderColor = '#10b981', bgColor = '#ecfdf5', textColor = '#047857';
  if(status === 'ชำรุด') { borderColor = '#ef4444'; bgColor = '#fef2f2'; textColor = '#dc2626'; }
  else if(status === 'รอจำหน่าย') { borderColor = '#f59e0b'; bgColor = '#fffbeb'; textColor = '#b45309'; }
  else if(status === 'จำหน่ายแล้ว') { borderColor = '#6b7280'; bgColor = '#f3f4f6'; textColor = '#374151'; }
  
  const style = `background-color: ${bgColor}; border: 2.5px solid ${borderColor}; color: ${textColor}; border-radius: 8px; padding: 3px 6px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; box-shadow: 0 3px 8px rgba(0,0,0,0.25); white-space: nowrap;`;
  return L.divIcon({ html: `<div style="${style}">${text}</div>`, iconSize: [85, 26], iconAnchor: [42, 13], className: 'custom-numbered-icon' });
}

function updateStatisticsCounters(data) {
  if (!data) return;
  const total = data.length;
  const damaged = data.filter(x => (x.Status || x.status || '').toString().trim() === 'ชำรุด').length;
  const normal = data.filter(x => (x.Status || x.status || '').toString().trim() === 'ปกติ').length;
  const pending = data.filter(x => (x.Status || x.status || '').toString().trim() === 'รอจำหน่าย').length;
  const disposed = data.filter(x => (x.Status || x.status || '').toString().trim() === 'จำหน่ายแล้ว').length;

  document.getElementById('count_all').innerText = total;
  document.getElementById('count_normal').innerText = normal;
  document.getElementById('count_damaged').innerText = damaged;
  document.getElementById('count_pending').innerText = pending;
  document.getElementById('count_disposed').innerText = disposed;
}

// 🌟 ฟังก์ชันสร้าง Dropdown เริ่มต้น
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

  // เรียกอัปเดตสถานที่ตามหน่วยงานที่เลือกเริ่มต้น
  updateLocationDropdownByDepartment(dSelect.value);
}

// 🌟 ฟังก์ชันอัปเดต Dropdown สถานที่แบบไดนามิกเฉพาะของหน่วยงานนั้นๆ
function updateLocationDropdownByDepartment(dept) {
  const lSelect = document.getElementById('locationFilter');
  if (!lSelect) return;

  let filteredByDept = allData;
  if (dept && dept !== 'all') {
    filteredByDept = allData.filter(x => x['หน่วยงาน'] === dept);
  }

  const locs = [...new Set(filteredByDept.map(x => x['ที่ตั้ง']).filter(Boolean))];
  lSelect.innerHTML = '<option value="all">📍 ทุกสถานที่</option>';
  locs.forEach(l => lSelect.innerHTML += `<option value="${l}">${l}</option>`);
}

// 🌟 Event Trigger เมื่อผู้ใช้เปลี่ยนการเลือกใน Dropdown หน่วยงาน
function onDepartmentFilterChange() {
  const dSelect = document.getElementById('departmentFilter');
  if (!dSelect) return;
  
  // 1. อัปเดตรายชื่อสถานที่ให้เหลือเฉพาะในหน่วยงานที่เลือก
  updateLocationDropdownByDepartment(dSelect.value);
  
  // 2. สั่งกรองข้อมูลและวาดหมุดบนแผนที่ใหม่
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

  let totalCount = 0, normalCount = 0, damagedCount = 0, pendingCount = 0, disposedCount = 0;

  if (allData && allData.length > 0) {
    allData.forEach(item => {
      if (isOfficer && !isAdmin && currentDepartment && item['หน่วยงาน'] !== currentDepartment) return;
      if (selectedDept !== 'all' && item['หน่วยงาน'] !== selectedDept) return;
      if (selectedLocation !== 'all' && item['ที่ตั้ง'] !== selectedLocation) return;
      
      totalCount++;
      const currentSt = (item.Status || item.status || '').toString().trim();
      if (currentSt === 'ปกติ') normalCount++;
      else if (currentSt === 'ชำรุด') damagedCount++;
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

// ==========================================
// 📋 Details Workspace Modal
// ==========================================
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
  } else if (currentSt === 'รอจำหน่าย') {
    badge.innerHTML = idCapsule + ' ⏳ รอจำหน่าย';
    badge.className = 'text-sm font-bold px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center';
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

async function refreshHistoryView(equipId) {
  const container = document.getElementById('wsRepairHistoryContainer');
  if (!container) return;
  container.innerHTML = '<p class="text-slate-400 text-center py-2">⏳ กำลังประมวลผลประวัติ...</p>';

  try {
    const res = await apiGet('getRepairHistory');
    const history = res.data || [];
    const searchKey = equipId.toString().trim().toUpperCase();
    const filtered = history.filter(h => h && h.assetId && h.assetId.toString().trim().toUpperCase() === searchKey);

    filtered.sort((a, b) => {
      const parseDate = (dStr) => {
        if (!dStr) return 0;
        const p = dStr.split('/');
        let y = parseInt(p[2], 10);
        if (y > 2400) y -= 543;
        return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
      };
      return parseDate(b.date) - parseDate(a.date);
    });

    const activePending = filtered.find(h => h.status === 'รอดำเนินการ');
    if (activePending && isTechnician) {
      document.getElementById('techRepairId').value = activePending.repairId;
      const badge = document.getElementById('techRepairIdBadge');
      badge.innerText = "📋 ดำเนินการปิดใบงาน: " + activePending.repairId;
      badge.classList.remove('hidden');
    }

    const summaryHtml = `<div class="bg-slate-100 text-slate-700 p-2.5 rounded-xl border text-[11px] font-bold flex justify-between items-center mb-1 shadow-2xs w-full"><span>📊 จำนวนครั้งแจ้งชำรุดสะสม:</span><span class="bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 rounded-full font-extrabold">${filtered.length} ครั้ง</span></div>`;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="flex flex-col gap-1 w-full">${summaryHtml}<p class="text-slate-400 text-center py-4 bg-white border rounded-xl">ไม่มีประวัติบันทึกการแจ้งซ่อม</p></div>`;
      return;
    }

    let html = '';
    filtered.forEach((h, i) => {
      const isDone = h.status === 'ซ่อมเสร็จสิ้น';
      html += `
        <div class="bg-white border rounded-xl p-3 shadow-xs border-l-4 ${isDone ? 'border-l-emerald-500' : 'border-l-rose-500'} flex flex-col gap-2 w-full">
          <div class="flex justify-between items-start border-b pb-1.5">
            <div><span class="font-bold text-[11px] text-slate-800">📅 ใบงาน: [${h.repairId}]</span> <span class="text-[10px] text-slate-400">${h.date}</span></div>
            <span class="px-2 py-0.5 rounded-full border text-[10px] font-bold ${isDone ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}">${h.status}</span>
          </div>
          <div class="text-[11px] text-slate-700 bg-slate-50 p-2 rounded-lg border">${h.details}</div>
          <div class="text-[10px] text-slate-400">👤 ผู้เกี่ยวข้อง: ${h.reporter}</div>
          ${h.imageAfter ? `<div class="text-right"><button type="button" onclick="openImageModal('${h.imageAfter}')" class="text-emerald-600 font-bold underline text-xs cursor-pointer">🔍 ดูภาพหลักฐาน</button></div>` : ''}
        </div>
      `;
    });
    container.innerHTML = `<div class="flex flex-col gap-2 w-full">${summaryHtml}<div class="space-y-2 w-full">${html}</div></div>`;
  } catch(e) {
    container.innerHTML = '<p class="text-rose-500 text-center">เกิดข้อผิดพลาดในการโหลดประวัติ</p>';
  }
}

function findAndOpenAsset(id) {
  const target = allData.find(x => x.ID.toString().trim().toUpperCase() === id.toString().trim().toUpperCase());
  if (target) {
    openDetailsWorkspace(target);
    const m = markerDict[target.ID];
    if (markersLayer && m) markersLayer.zoomToShowLayer(m, () => {});
  }
}

// ==========================================
// 🔧 Tech & Repair Forms Handler
// ==========================================
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
  const data = {
    repairId: document.getElementById('techRepairId').value,
    assetId: document.getElementById('techEquipId').value,
    details: completeDetails,
    technicianName: document.getElementById('techName').value,
    imageAfter: null
  };

  const fInput = document.getElementById('imageAfterFile');
  showLoadingModal("🔧 กำลังบันทึกปิดงานซ่อม...", "ระบบกำลังประมวลผลรูปภาพและข้อมูล");

  const send = async () => {
    try {
      const res = await apiPost('updateRepairStatus', data);
      hideLoadingModal();
      if (btn) btn.disabled = false;
      showQuietAlert(res.message);
      if (res.success) {
        document.getElementById('techForm').reset();
        document.getElementById('dynamicMaterialsList').innerHTML = '';
        loadMarkers();
        closeModal();
      }
    } catch (err) {
      hideLoadingModal();
      if (btn) btn.disabled = false;
      showQuietAlert("❌ เกิดข้อผิดพลาด: " + err.toString());
    }
  };

  if (fInput.files.length > 0) {
    compressImage(fInput.files[0], b64 => {
      data.imageAfter = { base64: b64, name: fInput.files[0].name, type: "image/jpeg" };
      send();
    });
  } else {
    send();
  }
}

// ==========================================
// 📑 Tables & Pagination Handler
// ==========================================
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

// 🌟 สร้าง Dropdown เริ่มต้นสำหรับตารางงานซ่อมเสร็จ
function initSuccessDropdowns(data) {
  const sdSelect = document.getElementById('successDeptFilter');
  if (!sdSelect) return;
  const depts = [...new Set(data.map(x => x.department).filter(Boolean))];
  sdSelect.innerHTML = '<option value="all">🏢 ทุกหน่วยงาน</option>';
  depts.forEach(d => sdSelect.innerHTML += `<option value="${d}">${d}</option>`);
  
  updateSuccessLocationDropdown(sdSelect.value);
}

// 🌟 อัปเดตสถานที่แบบไดนามิกในตารางงานซ่อมเสร็จ
function updateSuccessLocationDropdown(dept) {
  const slSelect = document.getElementById('successLocFilter');
  if (!slSelect) return;

  let filtered = successListRaw;
  if (dept && dept !== 'all') {
    filtered = successListRaw.filter(x => x.department === dept);
  }

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
        <td class="p-2"><div class="font-semibold text-slate-800">${h.details}</div><div class="text-[10px] text-slate-400">👤 ช่าง: ${h.reporter} | 🏢 ${h.department} (📍 ${h.location})</div></td>
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
    else if(item.Status === 'รอจำหน่าย') st = '<span class="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 rounded-full">⏳ รอจำหน่าย</span>';
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

// ==========================================
// 📍 Index Sheet Popup Handler
// ==========================================
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

// ==========================================
// ➕ Asset Add & Edit Modals Handler
// ==========================================
function openAddAssetModal() {
  if (!isOfficer) return;
  document.getElementById('addAssetModal')?.classList.remove('hidden');
  const dInput = document.getElementById('add_department');
  if (dInput) {
    dInput.value = currentDepartment;
    dInput.readOnly = (currentDepartment !== "ส่วนยุทธศาสตร์พื้นที่สีเขียว");
  }
}

function closeAddAssetModal() { document.getElementById('addAssetModal')?.classList.add('hidden'); document.getElementById('addEquipmentForm').reset(); }

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
  document.getElementById('editAssetModal')?.classList.remove('hidden');
}

function closeEditAssetModal() { document.getElementById('editAssetModal')?.classList.add('hidden'); }

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('addSubmitBtn');
  btn.disabled = true;
  btn.innerText = "⏳ กำลังบันทึกข้อมูล...";

  const data = {
    type: form.type.value, assetNo: form.assetNo.value, name: form.name.value,
    department: form.department.value, location: form.location.value,
    lat: form.lat.value, lng: form.lng.value, status: form.status.value,
    note: form.note.value || '', imageFile: null, qrCodeFile: null
  };

  const proceed = async () => {
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
  };

  const fInput = document.getElementById('imageFile'), qInput = document.getElementById('qrCodeFile');
  if (fInput.files.length > 0) {
    compressImage(fInput.files[0], b64 => {
      data.imageFile = { base64: b64, name: fInput.files[0].name, type: "image/jpeg" };
      if (qInput.files.length > 0) {
        compressImage(qInput.files[0], qb64 => {
          data.qrCodeFile = { base64: qb64, name: qInput.files[0].name, type: "image/jpeg" };
          proceed();
        });
      } else { proceed(); }
    });
  } else { proceed(); }
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
    imageFile: null, qrCodeFile: null
  };

  const proceed = async () => {
    try {
      const res = await apiPost('updateEquipment', sendData);
      btn.disabled = false;
      btn.innerText = "💾 บันทึกแก้ไขโครงสร้างข้อมูล";
      showQuietAlert(res.message);
      if (res.success) { closeEditAssetModal(); closeModal(); loadMarkers(); }
    } catch(err) {
      btn.disabled = false;
      showQuietAlert("❌ แก้ไขล้มเหลว");
    }
  };

  const imgInput = document.getElementById('editImageFile'), qrInput = document.getElementById('editQrCodeFile');
  if (imgInput.files.length > 0) {
    compressImage(imgInput.files[0], b64 => {
      sendData.imageFile = { base64: b64, name: imgInput.files[0].name, type: "image/jpeg" };
      if (qrInput.files.length > 0) {
        compressImage(qrInput.files[0], qb64 => {
          sendData.qrCodeFile = { base64: qb64, name: qrInput.files[0].name, type: "image/jpeg" };
          proceed();
        });
      } else { proceed(); }
    });
  } else { proceed(); }
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

// ==========================================
// 📥 Export CSV & PDF Handlers
// ==========================================
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

// ==========================================
// 🔒 Auth & Layout Management
// ==========================================
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
