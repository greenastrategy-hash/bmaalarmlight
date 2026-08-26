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
async function refreshHistoryView(equipId) {
  const container = document.getElementById('wsRepairHistoryContainer');
  if (!container) return;
  container.innerHTML = '<p class="text-slate-400 text-center py-4 text-xs font-medium">⏳ กำลังโหลดประวัติไทม์ไลน์การบำรุงรักษาอย่างละเอียด...</p>';

  try {
    const res = await apiGet('getRepairHistory');
    const history = res.data || [];
    const searchKey = equipId.toString().trim().toUpperCase();
    
    // 1. กรองประวัติทั้งหมดของครุภัณฑ์ ID นี้ (รวมทุกสถานะ)
    const filtered = history.filter(h => h && h.assetId && h.assetId.toString().trim().toUpperCase() === searchKey);

    // 2. เรียงลำดับไทม์ไลน์: รายการล่าสุดอยู่บนสุด
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
    if (activeTicket) {
      const techRepIdInput = document.getElementById('techRepairId');
      const badge = document.getElementById('techRepairIdBadge');
      if (techRepIdInput) techRepIdInput.value = activeTicket.repairId;
      if (badge) {
        badge.innerText = `📋 ดำเนินการใบงาน: ${activeTicket.repairId} (${activeTicket.status})`;
        badge.classList.remove('hidden');
      }
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

    // 3. วนลูปแจงรายละเอียดทุกขั้นตอน + แสดงรูปภาพพรีวิว (Thumbnail)
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

  } catch (e) {
    container.innerHTML = '<p class="text-rose-500 text-center py-4 text-xs font-bold">❌ เกิดข้อผิดพลาดในการดึงข้อมูลไทม์ไลน์ประวัติ</p>';
  }
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
// 📄 ฟังก์ชัน Export PDF (แก้ปัญหาสี oklch ถาวร)
// ==========================================
function exportHistoryPDF(equipId) {
  const element = document.getElementById('wsRepairHistoryContainer') || document.getElementById('pdfPrintArea');
  if (!element) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบพื้นที่ข้อมูลสำหรับออกเอกสาร PDF");
    return;
  }

  if (typeof showQuietAlert === 'function') showQuietAlert("⏳ กำลังสร้างไฟล์ PDF ประวัติการบำรุงรักษา...");

  const opt = {
    margin:       [8, 8, 8, 8],
    filename:     `ประวัติการซ่อมบำรุง_${equipId || 'Report'}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { 
      scale: 2, 
      useCORS: true, 
      logging: false 
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    if (typeof showQuietAlert === 'function') showQuietAlert("✅ Export PDF ประวัติสำเร็จเรียบร้อย");
  }).catch(err => {
    if (typeof showQuietAlert === 'function') showQuietAlert("❌ ออก PDF ไม่สำเร็จ: " + err.toString());
  });
}

// ==========================================
// 📄 2. ฟังก์ชันเรียกออกใบเบิกวัสดุ (Server-side Trigger)
// ==========================================
function triggerExportMaterialPDF(repairId) {
  if (!repairId) return;
  if (typeof showQuietAlert === 'function') showQuietAlert("📄 ระบบกำลังสร้างเอกสารใบเบิกวัสดุอุปกรณ์ (PDF)...");

  google.script.run
    .withSuccessHandler(function(res) {
      if (res.success) {
        const a = document.createElement('a');
        a.href = "data:application/pdf;base64," + res.base64;
        a.download = res.filename;
        a.click();
        if (typeof showQuietAlert === 'function') showQuietAlert("✅ ดาวน์โหลดใบเบิกวัสดุอุปกรณ์สำเร็จ");
      } else {
        if (typeof showQuietAlert === 'function') showQuietAlert("❌ " + res.message);
      }
    })
    .withFailureHandler(function(err) {
      if (typeof showQuietAlert === 'function') showQuietAlert("❌ ออกใบเบิกไม่สำเร็จ: " + err.toString());
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
  const data = {
    repairId: document.getElementById('techRepairId').value,
    assetId: document.getElementById('techEquipId').value,
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
      loadMarkers();
      closeModal();
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
    type: form.type.value, assetNo: form.assetNo.value, name: form.name.value,
    department: form.department.value, location: form.location.value,
    lat: form.lat.value, lng: form.lng.value, status: form.status.value,
    note: form.note.value || '', 
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
// 📄 ฟังก์ชันเรียกออกรายงาน PDF (A4) รูปแบบเต็ม
// (รองรับทั้ง Google Apps Script และ GitHub Pages / Standalone Client)
// ==========================================
function triggerExportPDF() {
  if (typeof currentActiveId === 'undefined' || !currentActiveId) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบรหัสครุภัณฑ์ที่ต้องการส่งออก PDF");
    return;
  }

  // หากใช้งานบน Google Apps Script Web App
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    if (typeof showQuietAlert === 'function') showQuietAlert("📄 ระบบกำลังสร้างเอกสารรายงาน PDF (A4)...");
    google.script.run
      .withSuccessHandler(function(res) {
        if (res && res.success) {
          const a = document.createElement('a');
          a.href = "data:application/pdf;base64," + res.base64;
          a.download = res.filename;
          a.click();
          if (typeof showQuietAlert === 'function') showQuietAlert("✅ ดาวน์โหลดไฟล์ PDF สำเร็จ");
        } else {
          if (typeof showQuietAlert === 'function') showQuietAlert("❌ " + (res ? res.message : "การออก PDF ล้มเหลว"));
        }
      })
      .withFailureHandler(function(err) {
        if (typeof showQuietAlert === 'function') showQuietAlert("❌ เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์: " + err.toString());
      })
      .exportAssetPDF(currentActiveId);
  } else {
    // หากใช้งานบน GitHub Pages: สร้างรูปเล่มรายงาน A4 ฉบับเต็มฝั่ง Client
    generateA4ReportPDFClient(currentActiveId);
  }
}

// ==========================================
// 📄 ฟังก์ชัน Render โครงสร้างรายงาน A4 ครบทุกส่วน (Client-side A4 Generator)
// ==========================================
function generateA4ReportPDFClient(equipId) {
  // ดึงข้อมูลครุภัณฑ์จากฐานข้อมูลในระบบ
  const allAssets = window.allAssetsData || window.equipmentData || [];
  const item = allAssets.find(x => x && (x.ID || x.id || '').toString().trim().toUpperCase() === equipId.toString().trim().toUpperCase()) || window.currentActiveAssetData;

  if (!item) {
    if (typeof showQuietAlert === 'function') showQuietAlert("⚠️ ไม่พบข้อมูลครุภัณฑ์สำหรับสร้างรายงาน");
    return;
  }

  if (typeof showQuietAlert === 'function') showQuietAlert("⏳ กำลังจัดรูปแบบรายงาน PDF (A4)...");

  // ดึงประวัติการแจ้งซ่อมย้อนหลัง
  const allHistory = window.allRepairHistoryData || window.repairHistoryData || [];
  const historyList = allHistory.filter(h => h && h.assetId && h.assetId.toString().trim().toUpperCase() === equipId.toString().trim().toUpperCase());
  const totalReports = historyList.length;

  // สร้างแถวข้อมูลตารางประวัติ
  let historyRowsHtml = historyList.map(h => {
    let statusColor = h.status === 'ซ่อมเสร็จสิ้น' ? '#059669' : '#d97706';
    let detailsClean = h.details || '';
    let formattedDetails = '';

    if (detailsClean.indexOf('[ช่างบันทึก]:') !== -1) {
      let splits = detailsClean.split('[ช่างบันทึก]:');
      let reportPart = splits[0].trim();
      let techPart = splits[1].trim();
      formattedDetails = '<b>🚨 รายการแจ้งซ่อม:</b> ' + reportPart + '<br/>';

      if (techPart.indexOf('OP_TYPE:') !== -1) {
        let opType = techPart.split('OP_TYPE:')[1].split('##')[0];
        let techDetailsText = techPart.split('DETAILS:')[1].split('##')[0];
        let techMaterialsText = techPart.split('MATERIALS:')[1] || '';
        let badgeColor = opType === 'ซ่อมแซมเอง' ? 'background-color:#e6f4ea; color:#137333;' : 'background-color:#fef7e0; color:#b06000;';

        formattedDetails += '<div style="margin-top:4px; padding-top:4px; border-top:1px dashed #cbd5e1; font-size:11px; line-height:1.3;">';
        formattedDetails += '  <b>🔧 ผลดำเนินการซ่อม:</b> <span style="' + badgeColor + ' padding:1px 5px; border-radius:4px; font-weight:bold; font-size:10px;">' + opType + '</span><br/>';
        formattedDetails += '  <span style="color:#065f46;">• รายละเอียด: ' + techDetailsText + '</span>';
        if (opType === 'ซ่อมแซมเอง') {
          formattedDetails += '<br/><span style="color:#475569;">• 📦 วัสดุ: ' + techMaterialsText + '</span>';
        }
        formattedDetails += '</div>';
      } else {
        formattedDetails += '<div style="margin-top:4px; border-top:1px dashed #cbd5e1; font-size:11px;"><span style="color:#065f46;"><b>🔧 ผลดำเนินการซ่อม:</b> ' + techPart + '</span></div>';
      }
    } else {
      formattedDetails = '<b>🚨 รายการแจ้งซ่อม:</b> ' + detailsClean;
    }

    let reporterClean = h.reporter || '';
    let formattedReporter = reporterClean.indexOf(' / ช่าง:') !== -1 ?
      '<b>👤 ผู้แจ้ง:</b> ' + reporterClean.split(' / ช่าง:')[0].trim() + '<br/><b>🔧 ช่าง:</b> ' + reporterClean.split(' / ช่าง:')[1].trim() :
      '<b>👤 ผู้แจ้ง:</b> ' + reporterClean;

    return '<tr>' +
      '<td style="padding:5px; border:1px solid #cbd5e1; text-align:center; font-size:11px;">' + (h.date || '-') + '<br/><b style="color:#64748b; font-size:10px;">' + (h.repairId || '') + '</b></td>' +
      '<td style="padding:5px; border:1px solid #cbd5e1; font-size:11px;">' + formattedDetails + '</td>' +
      '<td style="padding:5px; border:1px solid #cbd5e1; text-align:center; font-weight:bold; color:' + statusColor + '; font-size:11px;">' + (h.status || '-') + '</td>' +
      '<td style="padding:5px; border:1px solid #cbd5e1; font-size:11px;">' + formattedReporter + '</td>' +
    '</tr>';
  }).join('');

  if (historyList.length === 0) {
    historyRowsHtml = '<tr><td colspan="4" style="padding:10px; text-align:center; color:#94a3b8; font-size:11px;">ไม่มีบันทึกประวัติการแจ้งชำรุดเสียหายในระบบ</td></tr>';
  }

  // รูปภาพจุดติดตั้ง และ QR Code
  const assetImgSrc = item.Image || item.image || document.getElementById('wsImg')?.src || '';
  const qrImgSrc = item.QRCode || item.qrCode || document.getElementById('wsUploadedQr')?.src || '';

  const assetImgTag = (assetImgSrc && !assetImgSrc.includes('data:,')) ? `<img src="${assetImgSrc}" crossorigin="anonymous" style="max-height:150px; max-width:100%; object-fit:contain; border-radius:6px;"/>` : '<p style="color:#94a3b8; font-size:11px;">(ไม่มีภาพถ่ายประกอบ)</p>';
  const qrImgTag = (qrImgSrc && !qrImgSrc.includes('data:,')) ? `<img src="${qrImgSrc}" crossorigin="anonymous" style="max-height:120px; max-width:100%; object-fit:contain; border-radius:6px;"/>` : '<p style="color:#94a3b8; font-size:11px;">(ไม่มี QR Code)</p>';

  // สร้าง DOM ชั่วคราวโครงสร้าง A4 ตามรูปแบบเดิมในภาพ
  const reportContainer = document.createElement('div');
  reportContainer.id = 'tempA4ReportContainer';
  reportContainer.style.position = 'absolute';
  reportContainer.style.left = '-9999px';
  reportContainer.style.top = '-9999px';
  reportContainer.style.width = '790px';
  reportContainer.style.backgroundColor = '#ffffff';
  reportContainer.style.color = '#1e293b';
  reportContainer.style.fontFamily = 'Garuda, Thonburi, Tahoma, sans-serif';
  reportContainer.style.padding = '20px';
  reportContainer.style.boxSizing = 'border-box';

  const printDateStr = new Date().toLocaleDateString('th-TH');

  reportContainer.innerHTML = `
    <div style="text-align:center; border-bottom:2px double #059669; padding-bottom:4px; margin-bottom:10px;">
      <h2 style="font-size:18px; font-weight:bold; color:#065f46; margin:0 0 3px 0;">รายงานข้อมูลคุณลักษณะและทะเบียนประวัติครุภัณฑ์ประจำพิกัด</h2>
      <p style="font-size:11px; color:#64748b; margin:0;">รหัสอ้างอิง: ${item.ID || item.id || '-'} | วันที่พิมพ์เอกสาร: ${printDateStr}</p>
    </div>

    <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
      <tr>
        <td width="68%" style="text-align:center; background-color:#f8fafc; padding:8px; border:1px solid #e2e8f0; border-radius:8px; vertical-align:middle;">
          <b style="font-size:11px; color:#334155;">📷 ภาพถ่ายจุดติดตั้งครุภัณฑ์ปัจจุบัน</b><br/><br/>
          ${assetImgTag}
        </td>
        <td width="2%"></td>
        <td width="30%" style="text-align:center; background-color:#f8fafc; padding:8px; border:1px solid #e2e8f0; border-radius:8px; vertical-align:middle;">
          <b style="font-size:11px; color:#334155;">🔗 QR Code เพิ่มเติม</b><br/><br/>
          ${qrImgTag}
        </td>
      </tr>
    </table>

    <div style="font-size:13px; font-weight:bold; color:#0f172a; margin-top:8px; margin-bottom:4px; border-left:4px solid #059669; padding-left:6px;">
      📝 ข้อมูลผังทะเบียนคุณลักษณะครุภัณฑ์หลัก
    </div>

    <table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:12px;">
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td width="50%" style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">ดัชนีทรัพย์สิน</span><br/>
          <b style="font-size:14px; color:#0f172a;">${item.ID || item.id || '-'}</b>
        </td>
        <td width="50%" style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">ประเภททรัพย์สิน</span><br/>
          <span style="font-size:13px; color:#0f172a;">${item['ประเภททรัพย์สิน'] || item.type || '-'}</span>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">เลขทะเบียนทรัพย์สิน</span><br/>
          <span style="font-size:13px; color:#0f172a;">${item['เลขทะเบียนทรัพย์สิน'] || item.assetNo || '-'}</span>
        </td>
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">ชื่อครุภัณฑ์ทรัพย์สิน</span><br/>
          <b style="font-size:13px; color:#0f172a;">${item['ชื่อทรัพย์สิน'] || item.Name || item.name || '-'}</b>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">หน่วยงานผู้รับผิดชอบ</span><br/>
          <span style="font-size:13px; color:#0f172a;">${item['หน่วยงาน'] || item.department || '-'}</span>
        </td>
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">สถานที่ติดตั้งหลัก</span><br/>
          <b style="font-size:13px; color:#065f46;">📍 ${item['ที่ตั้ง'] || item.location || '-'}</b>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">สถานะปัจจุบันในระบบ</span><br/>
          <span style="font-size:13px; color:#0f172a;">${item.Status || item.status || '-'}</span>
        </td>
        <td style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">พิกัดแผนที่</span><br/>
          <span style="font-size:12px; color:#0f172a;">ละติจูด ${item.Lat || item.lat || '0'} , ลองจิจูด ${item.Lng || item.lng || '0'}</span>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding:4px;">
          <span style="font-size:10px; color:#64748b; font-weight:bold;">หมายเหตุเพิ่มเติม (Note)</span><br/>
          <span style="font-size:12px; color:#334155;">${item.Note || item.note || '-'}</span>
        </td>
      </tr>
    </table>

    <div style="font-size:13px; font-weight:bold; color:#0f172a; margin-top:8px; margin-bottom:4px; border-left:4px solid #059669; padding-left:6px;">
      📜 บันทึกประวัติและไทม์ไลน์การแจ้งซ่อมบำรักษาย้อนหลัง
    </div>

    <div style="background-color:#fff1f2; padding:4px 8px; border:1px solid #fecdd3; border-radius:6px; margin-bottom:6px; font-size:11px; font-weight:bold; color:#9f1239;">
      📊 จำนวนครั้งที่แจ้งชำรุดสะสมในฐานระบบ: <span style="color:#e11d48; font-size:13px;">${totalReports} ครั้ง</span>
    </div>

    <table style="width:100%; border-collapse:collapse; font-size:11px;">
      <thead>
        <tr style="background-color:#f1f5f9; color:#334155;">
          <th width="18%" style="padding:5px; border:1px solid #cbd5e1; text-align:center;">วันที่ / เลขใบงาน</th>
          <th width="52%" style="padding:5px; border:1px solid #cbd5e1; text-align:center;">รายละเอียดบันทึกกิจกรรมซ่อมบำรุง / วัสดุอุปกรณ์ที่ใช้</th>
          <th width="15%" style="padding:5px; border:1px solid #cbd5e1; text-align:center;">สถานะใบงาน</th>
          <th width="15%" style="padding:5px; border:1px solid #cbd5e1; text-align:center;">ผู้เกี่ยวข้อง</th>
        </tr>
      </thead>
      <tbody>
        ${historyRowsHtml}
      </tbody>
    </table>
  `;

  document.body.appendChild(reportContainer);

  const opt = {
    margin:       [8, 8, 8, 8],
    filename:     `Report_${equipId}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, logging: false },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(reportContainer).save().then(() => {
    document.body.removeChild(reportContainer);
    if (typeof showQuietAlert === 'function') showQuietAlert("✅ Export PDF รายงาน A4 สำเร็จเรียบร้อย");
  }).catch(err => {
    if (document.body.contains(reportContainer)) document.body.removeChild(reportContainer);
    if (typeof showQuietAlert === 'function') showQuietAlert("❌ สร้าง PDF A4 ไม่สำเร็จ: " + err.toString());
  });
}

// =========================================================================
// 📄 ฟังก์ชันฝั่งหน้าบ้านสำหรับกดปุ่ม ใบเบิกวัสดุอุปกรณ์ (PDF)
// =========================================================================
function triggerExportMaterialPDF(repairId) {
  if (!repairId) return;
  showQuietAlert("📄 ระบบกำลังสร้างเอกสารใบเบิกวัสดุอุปกรณ์ (PDF)...");

  google.script.run
    .withSuccessHandler(function(res) {
      if (res.success) {
        var a = document.createElement('a');
        a.href = "data:application/pdf;base64," + res.base64;
        a.download = res.filename;
        a.click();
        showQuietAlert("✅ ดาวน์โหลดใบเบิกวัสดุอุปกรณ์สำเร็จ");
      } else {
        showQuietAlert("❌ " + res.message);
      }
    })
    .withFailureHandler(function(err) {
      showQuietAlert("❌ ออกใบเบิกไม่สำเร็จ: " + err.toString());
    })
    .exportMaterialRequisitionPDF(repairId);
}
