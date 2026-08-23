let map, markersLayer, allData = [], markerDict = {};
let isOfficer = false, isTechnician = false, isAdmin = false, currentDepartment = "";
let currentActiveId = "", currentActiveItemRaw = null, bmaMaskLayer = null, bmaDistrictsLayer = null, bmaCachedGeoJSON = null;
let successListGlobal = [], successListRaw = [], currentPage = 1, recordsPerPage = 25;
let masterFilteredList = [], currentMasterPage = 1, masterRecordsPerPage = 25;
let masterDisplayList = []; 
let globalReportCounts = {};
let currentUserCode = "";

window.onload = function() { 
  initMap(); 
  loadMarkers(); 
};

// ==========================================
// 🌐 API Helper Functions (Fetch แทน google.script.run)
// ==========================================
async function apiGet(action, params = {}) {
  try {
    const url = new URL(API_BASE_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    
    // เพิ่ม redirect: 'follow' และโหมด cors
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    
    return await response.json();
  } catch (err) {
    console.error("API GET Error:", err);
    throw err;
  }
}

async function apiPost(action, data = {}) {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // GAS รับ text/plain เพื่อเลี่ยง CORS preflight
    body: JSON.stringify({ action: action, data: data })
  });
  return await response.json();
}

// ==========================================
// 🗺️ Leaflet Map Initializer
// ==========================================
function initMap() {
  try {
    const streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; CartoDB'
    });
    const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      attribution: '&copy; Google Maps'
    });

    map = L.map('map', {
      center: [13.745, 100.62],
      zoom: 11,
      layers: [streetLayer]
    });

    markersLayer = L.markerClusterGroup({ maxClusterRadius: 50, disableClusteringAtZoom: 17 });
    markersLayer.addTo(map);

    L.control.layers({ "🗺️ แผนที่ถนน": streetLayer, "🛰️ ภาพดาวเทียม": satelliteLayer }, null, { position: 'topleft' }).addTo(map);
  } catch (err) {
    console.error("Map initialization failed:", err);
  }
}

async function loadMarkers(userCode) {
  if (userCode !== undefined) currentUserCode = userCode;
  console.log("🚀 กำลังส่งคำขอไปที่ API:", API_BASE_URL);

  try {
    const res = await apiGet('getEquipmentData', { userCode: currentUserCode });
    console.log("📦 ข้อมูลที่ตอบกลับจาก Apps Script:", res);

    if (res && res.success) {
      allData = processDataSequence(res.data || []);
      console.log(`✅ โหลดข้อมูลสำเร็จ ${allData.length} รายการ`);
      
      updateStatisticsCounters(allData);
      updateFilterDropdowns(allData);
      applyFilters();

      // โหลดประวัติงานซ่อมต่อเบื้องหลัง
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
        }
      });
    } else {
      console.error("❌ API ตอบกลับล้มเหลว:", res ? res.message : "ไม่มีข้อมูลตอบกลับ");
      showQuietAlert("⚠️ ไม่สามารถดึงข้อมูลได้: " + (res ? res.message : "เกิดข้อผิดพลาด"));
    }
  } catch (err) {
    console.error("❌ Fetch Error:", err);
    showQuietAlert("❌ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบการตั้งค่าสิทธิ์ Apps Script");
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
      marker.on('click', () => { /* ฟังก์ชันเปิด Modal ข้อมูล */ });
      
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
  if (bounds.length > 0 && map) {
    map.setView(selectedLocation !== "all" ? [bounds[0][0], bounds[0][1]] : [13.745, 100.62], selectedLocation !== "all" ? 15 : 11);
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const pass = document.getElementById('officerPassword').value;
  showLoadingModal("🔒 กำลังตรวจสอบสิทธิ์...", "กรุณารอสักครู่");

  try {
    const res = await apiGet('verifyUserCode', { code: pass });
    hideLoadingModal();
    if (res.success) {
      isOfficer = (res.role === "admin" || res.role === "officer");
      isTechnician = (res.role === "technician");
      isAdmin = (res.role === "admin");
      currentDepartment = res.dept;

      closeAuthModal();
      loadMarkers(pass);
      showQuietAlert("🔓 ยืนยันสิทธิ์สำเร็จ: " + res.dept);
    } else {
      showQuietAlert("❌ " + res.message);
    }
  } catch (err) {
    hideLoadingModal();
    showQuietAlert("❌ เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว");
  }
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
    document.getElementById('loadingModalTitle').innerText = title;
    document.getElementById('loadingModalSub').innerText = sub;
    modal.classList.remove('hidden');
  }
}

function hideLoadingModal() {
  document.getElementById('loadingModal')?.classList.add('hidden');
}

function openAuthModal() { document.getElementById('authModal')?.classList.remove('hidden'); }
function closeAuthModal() { document.getElementById('authModal')?.classList.add('hidden'); }
