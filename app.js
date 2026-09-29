/* =========================================================
   منظومة المبيعات الاحترافية - النسخة الكاملة
   ========================================================= */

// ============ قاعدة البيانات ============
let DB = {
  products: [],
  invoices: [],
  returns: [],
  customers: [],
  expenses: [],
  settings: {
    storeName: 'متجري',
    storePhone: '',
    storeAddr: '',
    currency: 'ر.س',
    logo: '',
    passwordsEnabled: false,
    adminPass: '',
    empPass: '',
    stockPass: '',
    securityQuestion: '',
    securityAnswer: '',
    recoveryContact: '',
    darkMode: false,
    autoPrint: false,
    sound: true,
    lowStock: 5,
    taxRate: 0
  }
};

let currentUser = null;
let currentRole = null;

// ============ IndexedDB ============
const DB_NAME = 'SalesSystemDB';
const STORE = 'kv';
let idb = null;

function openIDB(){
  return new Promise(resolve => {
    try{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = e => { idb = e.target.result; resolve(); };
      req.onerror = () => { idb = null; resolve(); };
    }catch(e){
      idb = null;
      resolve();
    }
  });
}

async function saveDB(){
  const data = JSON.stringify(DB);
  let saved = false;

  if(idb){
    try{
      const tx = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, 'main');
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
      });
      saved = true;
    }catch(e){
      console.warn('IndexedDB save failed', e);
    }
  }
  if(!saved){
    try{
      localStorage.setItem('SalesSystem', data);
      saved = true;
    }catch(e){
      console.warn('localStorage save failed', e);
    }
  }
  localStorage.setItem('localUpdate', Date.now());

  // رفع تلقائي للسحابة في الخلفية
  if(window.FIREBASE_READY && syncEnabled && navigator.onLine){
    pushToCloud(true).catch(() => {});
  }
  return saved;
}

async function loadDB(){
  if(idb){
    try{
      const tx = idb.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('main');
      const val = await new Promise(res => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      if(val){
        const parsed = JSON.parse(val);
        DB = Object.assign(DB, parsed);
        if(parsed.settings) DB.settings = Object.assign(DB.settings, parsed.settings);
        return;
      }
    }catch(e){
      console.warn(e);
    }
  }
  const ls = localStorage.getItem('SalesSystem');
  if(ls){
    try{
      const parsed = JSON.parse(ls);
      DB = Object.assign(DB, parsed);
      if(parsed.settings) DB.settings = Object.assign(DB.settings, parsed.settings);
    }catch(e){}
  }
}

// ============ أدوات ============
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function fmt(n){
  return Number(n || 0).toFixed(2) + ' ' + DB.settings.currency;
}
function todayStr(){
  return new Date().toISOString().slice(0, 10);
}
function nowStr(){
  return new Date().toISOString();
}

function toast(msg, type){
  type = type || 'info';
  const box = document.getElementById('toastBox');
  if(!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = '.3s';
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

function beep(){
  if(!DB.settings.sound) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.1;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 120);
  }catch(e){}
}

function closeModal(id){
  const el = document.getElementById(id);
  if(el) el.classList.add('hidden');
}

// ============ Firebase Cloud Sync ============
let fbReady = false;
let syncEnabled = localStorage.getItem('syncEnabled') !== 'false';
let lastSync = localStorage.getItem('lastSync') || null;

window.addEventListener('firebase-ready', () => {
  fbReady = true;
  console.log('✅ Firebase ready');
  updateSyncStatus();
  if(syncEnabled) startRealtimeSync();
});

function storeRef(path){
  return window.fbRef(window.fbDB, 'stores/boqrain/' + path);
}

function updateSyncStatus(){
  const el = document.getElementById('syncStatus');
  const btn = document.getElementById('syncToggleBtn');
  if(btn) btn.textContent = syncEnabled ? '🔴 إيقاف المزامنة' : '🟢 تفعيل المزامنة';

  if(!el) return;
  if(!fbReady){
    el.innerHTML = '⚫ غير متصل بالسحابة';
    el.style.background = '#e5e7eb';
    el.style.color = '#374151';
    return;
  }
  if(!syncEnabled){
    el.innerHTML = '⏸️ المزامنة معطلة';
    el.style.background = '#fef3c7';
    el.style.color = '#92400e';
    return;
  }
  if(navigator.onLine){
    el.innerHTML = '☁️ متزامن ' +
      (lastSync ? '— آخر تحديث: ' + new Date(lastSync).toLocaleTimeString('ar-EG') : '');
    el.style.background = '#d1fae5';
    el.style.color = '#065f46';
  }else{
    el.innerHTML = '📴 بانتظار الاتصال بالإنترنت';
    el.style.background = '#fef3c7';
    el.style.color = '#92400e';
  }
}

async function pushToCloud(silent){
  if(!fbReady || !syncEnabled) return false;
  if(!navigator.onLine){
    if(!silent) toast('لا يوجد اتصال بالإنترنت', 'warn');
    return false;
  }

  try{
    const payload = {
      products:  DB.products,
      invoices:  DB.invoices,
      returns:   DB.returns,
      customers: DB.customers,
      expenses:  DB.expenses,
      settings:  DB.settings,
      lastUpdate: Date.now(),
      deviceId: window.DEVICE_ID
    };

    await window.fbSet(storeRef('main'), payload);
    lastSync = new Date().toISOString();
    localStorage.setItem('lastSync', lastSync);
    updateSyncStatus();
    if(!silent) toast('☁️ تم الرفع للسحابة', 'success');
    return true;
  }catch(e){
    console.error('pushToCloud failed', e);
    if(!silent) toast('فشل الرفع: ' + e.message, 'error');
    return false;
  }
}

async function pullFromCloud(silent){
  if(!fbReady) return false;
  if(!navigator.onLine){
    if(!silent) toast('لا يوجد اتصال', 'warn');
    return false;
  }

  try{
    const snap = await window.fbGet(storeRef('main'));
    if(!snap.exists()){
      if(!silent) toast('لا توجد بيانات سحابية', 'info');
      return false;
    }

    const cloud = snap.val();
    const cloudTime = cloud.lastUpdate || 0;
    const localTime = Number(localStorage.getItem('localUpdate') || 0);

    if(cloudTime > localTime){
      DB.products  = cloud.products  || [];
      DB.invoices  = cloud.invoices  || [];
      DB.returns   = cloud.returns   || [];
      DB.customers = cloud.customers || [];
      DB.expenses  = cloud.expenses  || [];
      DB.settings  = Object.assign(DB.settings, cloud.settings || {});

      // حفظ محلي بدون إعادة رفع
      const data = JSON.stringify(DB);
      if(idb){
        try{
          const tx = idb.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(data, 'main');
        }catch(e){}
      }
      try{ localStorage.setItem('SalesSystem', data); }catch(e){}
      localStorage.setItem('localUpdate', cloudTime);

      refreshCategories();
      renderPOSProducts();
      renderTabs();
      renderCart();
      if(typeof renderDashboard === 'function') renderDashboard();
      if(!silent) toast('⬇️ تم تحديث البيانات من السحابة', 'success');
    }else{
      if(!silent) toast('بياناتك محدثة بالفعل', 'info');
    }

    updateSyncStatus();
    return true;
  }catch(e){
    console.error('pullFromCloud failed', e);
    if(!silent) toast('فشل السحب: ' + e.message, 'error');
    return false;
  }
}

function startRealtimeSync(){
  if(!fbReady) return;
  try{
    window.fbOnValue(storeRef('main'), snap => {
      if(!snap.exists()) return;
      const cloud = snap.val();
      if(cloud.deviceId === window.DEVICE_ID) return;

      const cloudTime = cloud.lastUpdate || 0;
      const localTime = Number(localStorage.getItem('localUpdate') || 0);

      if(cloudTime > localTime){
        DB.products  = cloud.products  || [];
        DB.invoices  = cloud.invoices  || [];
        DB.returns   = cloud.returns   || [];
        DB.customers = cloud.customers || [];
        DB.expenses  = cloud.expenses  || [];
        DB.settings  = Object.assign(DB.settings, cloud.settings || {});

        const data = JSON.stringify(DB);
        if(idb){
          try{
            const tx = idb.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(data, 'main');
          }catch(e){}
        }
        try{ localStorage.setItem('SalesSystem', data); }catch(e){}
        localStorage.setItem('localUpdate', cloudTime);

        refreshCategories();
        renderPOSProducts();
        renderTabs();
        renderCart();
        toast('🔄 تم تحديث البيانات من جهاز آخر', 'info');
      }
      updateSyncStatus();
    });
  }catch(e){
    console.error('Realtime sync failed', e);
  }
}

function toggleSync(){
  syncEnabled = !syncEnabled;
  localStorage.setItem('syncEnabled', syncEnabled);
  updateSyncStatus();
  toast(syncEnabled ? '✅ المزامنة مفعّلة' : '⏸️ المزامنة معطلة', 'info');
  if(syncEnabled){
    startRealtimeSync();
    pushToCloud(false);
  }
}

// ============ الدخول ============
function tryLogin(){
  const role = document.getElementById('loginRole').value;
  const pass = document.getElementById('loginPass').value;
  const keys = { admin: 'adminPass', emp: 'empPass', stock: 'stockPass' };
  const storedPass = DB.settings[keys[role]];

  if(!DB.settings.passwordsEnabled || !storedPass){
    currentUser = role;
    currentRole = { admin: '👑 مدير', emp: '👤 كاشير', stock: '📦 مخزون' }[role];
    enterApp();
    return;
  }

  if(pass === storedPass){
    currentUser = role;
    currentRole = { admin: '👑 مدير', emp: '👤 كاشير', stock: '📦 مخزون' }[role];
    enterApp();
  }else{
    document.getElementById('loginError').textContent = '❌ كلمة المرور غير صحيحة';
  }
}

function enterApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userTag').textContent = currentRole;

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = currentUser === 'admin' ? '' : 'none';
  });

  if(currentUser === 'emp'){
    ['inventory', 'expenses', 'users', 'settings', 'backup'].forEach(p => {
      const el = document.querySelector('.nav-item[data-page="' + p + '"]');
      if(el) el.style.display = 'none';
    });
  }

  if(currentUser === 'stock'){
    ['pos', 'debts'].forEach(p => {
      const el = document.querySelector('.nav-item[data-page="' + p + '"]');
      if(el) el.style.display = 'none';
    });
  }

  applyBranding();
  applyPrefs();
  initAll();
  startBarcodeListener();
}

function enterAppDirectly(){
  currentUser = 'admin';
  currentRole = '👑 مدير';
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userTag').textContent = currentRole;
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = '';
  });
  applyBranding();
  applyPrefs();
}

function lockScreen(){
  if(!confirm('هل تريد قفل الشاشة والخروج؟')) return;
  saveOpenTabs();
  saveDB();
  setTimeout(() => location.reload(), 300);
}

function logout(){
  if(!confirm('هل تريد الخروج؟')) return;
  saveOpenTabs();
  saveDB();
  setTimeout(() => location.reload(), 300);
}

// ============ الإعداد الأول ============
function openSetupModal(){
  document.getElementById('setupAdmin').value = '';
  document.getElementById('setupAdmin2').value = '';
  document.getElementById('setupQuestion').value = DB.settings.securityQuestion || '';
  document.getElementById('setupAnswer').value = '';
  document.getElementById('setupRecovery').value = DB.settings.recoveryContact || '';
  document.getElementById('setupError').textContent = '';
  document.getElementById('setupModal').classList.remove('hidden');
}

function doFirstSetup(){
  const p1 = document.getElementById('setupAdmin').value.trim();
  const p2 = document.getElementById('setupAdmin2').value.trim();
  const q = document.getElementById('setupQuestion').value.trim();
  const a = document.getElementById('setupAnswer').value.trim();
  const rec = document.getElementById('setupRecovery').value.trim();
  const err = document.getElementById('setupError');

  if(p1.length < 3){
    err.textContent = '❌ كلمة المرور يجب أن تكون 3 أحرف على الأقل';
    return;
  }
  if(p1 !== p2){
    err.textContent = '❌ كلمتا المرور غير متطابقتين';
    return;
  }
  if(!q || !a){
    err.textContent = '❌ يجب إدخال سؤال الأمان وجوابه';
    return;
  }
  if(!rec){
    err.textContent = '❌ يجب إدخال رقم هاتف أو بريد للاستعادة';
    return;
  }

  DB.settings.adminPass = p1;
  DB.settings.passwordsEnabled = true;
  DB.settings.securityQuestion = q;
  DB.settings.securityAnswer = a.toLowerCase();
  DB.settings.recoveryContact = rec;

  saveDB();
  closeModal('setupModal');
  toast('✅ تم الإعداد! يمكنك الآن الدخول', 'success');
  document.getElementById('loginRole').value = 'admin';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').focus();
}

// ============ استعادة كلمة المرور ============
function openRecoveryModal(){
  const role = document.getElementById('loginRole').value;
  document.getElementById('recRole').value = role;
  updateRecoveryQuestion();
  document.getElementById('recAnswer').value = '';
  document.getElementById('recPhone').value = '';
  document.getElementById('recNewPass').value = '';
  document.getElementById('recError').textContent = '';
  document.getElementById('recoveryModal').classList.remove('hidden');
}

function updateRecoveryQuestion(){
  const role = document.getElementById('recRole').value;
  const q = DB.settings.securityQuestion || 'لم يتم إعداد سؤال أمان بعد';
  document.getElementById('recQuestion').value = q;
}

function doRecover(){
  const role = document.getElementById('recRole').value;
  const ans = document.getElementById('recAnswer').value.trim().toLowerCase();
  const rec = document.getElementById('recPhone').value.trim();
  const newPass = document.getElementById('recNewPass').value.trim();
  const err = document.getElementById('recError');

  if(!DB.settings.securityAnswer || !DB.settings.recoveryContact){
    err.textContent = '❌ لم يتم إعداد بيانات الاستعادة. تواصل مع المدير';
    return;
  }

  const answerOK = ans && ans === DB.settings.securityAnswer;
  const contactOK = rec && rec === DB.settings.recoveryContact;

  if(!answerOK && !contactOK){
    err.textContent = '❌ الجواب أو رقم الاستعادة غير صحيح';
    return;
  }

  if(newPass.length < 3){
    err.textContent = '❌ كلمة المرور الجديدة قصيرة (3 أحرف على الأقل)';
    return;
  }

  const key = { admin: 'adminPass', emp: 'empPass', stock: 'stockPass' }[role];
  DB.settings[key] = newPass;
  DB.settings.passwordsEnabled = true;
  saveDB();

  closeModal('recoveryModal');
  toast('✅ تم تغيير كلمة المرور بنجاح', 'success');
  document.getElementById('loginRole').value = role;
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').focus();
}

// ============ التنقل ============
function initNavigation(){
  document.querySelectorAll('.nav-item').forEach(a => {
    a.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      const page = document.getElementById('page-' + a.dataset.page);
      if(page) page.classList.add('active');
      const p = a.dataset.page;
      if(p === 'dashboard') renderDashboard();
      if(p === 'pos') renderPOSProducts();
      if(p === 'invoices') renderInvoices();
      if(p === 'returns') renderReturns();
      if(p === 'products') renderProducts();
      if(p === 'inventory') renderInventory();
      if(p === 'customers') renderCustomers();
      if(p === 'debts') renderDebts();
      if(p === 'expenses') renderExpenses();
      if(p === 'stats') renderStats();
      if(p === 'users') loadUsersForm();
      if(p === 'settings') loadSettingsForm();
      if(p === 'backup') updateSyncStatus();
    };
  });
}

// ============ التبويبات ============
let tabs = [];
let activeTabId = null;

function newTab(){
  const t = {
    id: uid(),
    customer: '',
    items: [],
    discount: 0,
    taxRate: DB.settings.taxRate || 0,
    held: false
  };
  tabs.push(t);
  activeTabId = t.id;
  renderTabs();
  renderCart();
}

function switchTab(id){
  activeTabId = id;
  renderTabs();
  renderCart();
}

function closeTab(id, e){
  if(e) e.stopPropagation();
  const t = tabs.find(x => x.id === id);
  if(!t) return;
  if(t.items.length && !confirm('الفاتورة فيها منتجات، هل تريد إغلاقها؟')) return;
  tabs = tabs.filter(x => x.id !== id);
  if(activeTabId === id) activeTabId = tabs[0] ? tabs[0].id : null;
  if(!tabs.length) newTab();
  else { renderTabs(); renderCart(); }
}

function holdTab(){
  const t = activeTab();
  if(!t) return;
  t.held = !t.held;
  toast(t.held ? 'تم تعليق الفاتورة' : 'تم إلغاء التعليق', 'success');
  renderTabs();
  renderCart();
}

function clearTab(){
  const t = activeTab();
  if(!t) return;
  if(!confirm('إلغاء كل المنتجات من الفاتورة؟')) return;
  t.items = [];
  t.discount = 0;
  t.customer = '';
  renderCart();
}

function activeTab(){
  return tabs.find(t => t.id === activeTabId) || null;
}

function renderTabs(){
  const list = document.getElementById('tabsList');
  if(!list) return;
  list.innerHTML = '';
  tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeTabId ? ' active' : '');
    const label = t.customer || ('فاتورة ' + (i + 1));
    const count = t.items.length;
    el.innerHTML = (t.held ? '⏸ ' : '') + label +
      (count ? ' (' + count + ')' : '') +
      ' <span class="close" onclick="closeTab(\'' + t.id + '\', event)">✕</span>';
    el.onclick = () => switchTab(t.id);
    list.appendChild(el);
  });
  saveOpenTabs();
}

function saveOpenTabs(){
  try{
    localStorage.setItem('openTabs', JSON.stringify({ tabs: tabs, activeTabId: activeTabId }));
  }catch(e){}
}

function loadOpenTabs(){
  try{
    const d = JSON.parse(localStorage.getItem('openTabs') || 'null');
    if(d && d.tabs && d.tabs.length){
      tabs = d.tabs;
      activeTabId = d.activeTabId;
      return;
    }
  }catch(e){}
  newTab();
}

// ============ نقطة البيع ============
function renderPOSProducts(){
  const grid = document.getElementById('posGrid');
  if(!grid) return;
  const q = (document.getElementById('posSearch').value || '').toLowerCase();
  const cat = document.getElementById('posCategory').value;
  grid.innerHTML = '';
  DB.products
    .filter(p => !q || p.name.toLowerCase().indexOf(q) !== -1 || (p.barcode || '').indexOf(q) !== -1)
    .filter(p => !cat || p.category === cat)
    .forEach(p => {
      const d = document.createElement('div');
      d.className = 'prod-card' + (p.qty <= 0 ? ' out' : '');
      d.innerHTML = '<h4>' + p.name + '</h4>' +
        '<div class="price">' + fmt(p.price) + '</div>' +
        '<div class="qty">المتوفر: ' + p.qty + '</div>';
      d.onclick = () => addToCart(p);
      grid.appendChild(d);
    });
}

function refreshCategories(){
  const sel = document.getElementById('posCategory');
  if(sel){
    const current = sel.value;
    const cats = [];
    DB.products.forEach(p => {
      if(p.category && cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    sel.innerHTML = '<option value="">كل الأصناف</option>' +
      cats.map(c => '<option>' + c + '</option>').join('');
    sel.value = current;
  }
  const dl = document.getElementById('catList');
  if(dl){
    const cats = [];
    DB.products.forEach(p => {
      if(p.category && cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    dl.innerHTML = cats.map(c => '<option>' + c + '</option>').join('');
  }
  const cl = document.getElementById('customersList');
  if(cl){
    cl.innerHTML = DB.customers.map(c =>
      '<option value="' + c.name + '">' + (c.phone || '') + '</option>'
    ).join('');
  }
}

function addToCart(p){
  const t = activeTab();
  if(!t) return;
  if(t.held){
    toast('الفاتورة معلقة، ألغِ التعليق أولاً', 'warn');
    return;
  }
  if(p.qty <= 0){
    toast('المنتج غير متوفر', 'error');
    return;
  }
  const ex = t.items.find(i => i.id === p.id);
  if(ex){
    if(ex.qty >= p.qty){
      toast('لا توجد كمية كافية', 'error');
      return;
    }
    ex.qty++;
  }else{
    t.items.push({
      id: p.id,
      name: p.name,
      price: p.price,
      cost: p.cost || 0,
      qty: 1
    });
  }
  renderCart();
  beep();
}

function renderCart(){
  const t = activeTab();
  const box = document.getElementById('cartItems');
  if(!box) return;
  if(!t){ box.innerHTML = ''; return; }
  document.getElementById('cartCustomer').value = t.customer;
  document.getElementById('discount').value = t.discount;
  document.getElementById('taxRate').value = t.taxRate;
  box.innerHTML = '';
  t.items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'cart-item';
    d.innerHTML =
      '<span class="name">' + it.name + '</span>' +
      '<input type="number" min="1" value="' + it.qty + '" onchange="changeQty(' + i + ', this.value)">' +
      '<span class="price">' + (it.price * it.qty).toFixed(2) + '</span>' +
      '<i class="fa-solid fa-trash del" onclick="removeItem(' + i + ')"></i>';
    box.appendChild(d);
  });
  calcTotals();
}

function changeQty(i, v){
  const t = activeTab();
  if(!t) return;
  const q = Math.max(1, parseInt(v) || 1);
  const p = DB.products.find(x => x.id === t.items[i].id);
  if(p && q > p.qty){
    toast('الكمية أكبر من المتوفر', 'error');
    renderCart();
    return;
  }
  t.items[i].qty = q;
  renderCart();
}

function removeItem(i){
  const t = activeTab();
  if(!t) return;
  t.items.splice(i, 1);
  renderCart();
}

function calcTotals(){
  const t = activeTab();
  if(!t) return;
  let sub = 0;
  t.items.forEach(i => { sub += i.price * i.qty; });
  const disc = Number(t.discount) || 0;
  const after = Math.max(0, sub - disc);
  const tax = after * (Number(t.taxRate) || 0) / 100;
  const grand = after + tax;
  document.getElementById('subTotal').textContent = sub.toFixed(2);
  document.getElementById('grandTotal').textContent = grand.toFixed(2);
}

function bindCartInputs(){
  const cust = document.getElementById('cartCustomer');
  if(cust) cust.addEventListener('input', e => {
    const t = activeTab();
    if(t){ t.customer = e.target.value; renderTabs(); }
  });
  const disc = document.getElementById('discount');
  if(disc) disc.addEventListener('input', e => {
    const t = activeTab();
    if(t) t.discount = Number(e.target.value) || 0;
    calcTotals();
  });
  const tax = document.getElementById('taxRate');
  if(tax) tax.addEventListener('input', e => {
    const t = activeTab();
    if(t) t.taxRate = Number(e.target.value) || 0;
    calcTotals();
  });
  const payM = document.getElementById('payMethod');
  if(payM) payM.addEventListener('change', e => {
    document.getElementById('partialBox').style.display =
      e.target.value === 'partial' ? '' : 'none';
  });
}

// ============ الدفع ============
let pendingInvoice = null;
let lastInvoice = null;

function checkout(){
  const t = activeTab();
  if(!t || !t.items.length){
    toast('الفاتورة فارغة', 'warn');
    return;
  }
  for(const it of t.items){
    const p = DB.products.find(x => x.id === it.id);
    if(!p || p.qty < it.qty){
      toast('كمية غير كافية: ' + it.name, 'error');
      return;
    }
  }
  let sub = 0;
  t.items.forEach(i => { sub += i.price * i.qty; });
  const disc = Number(t.discount) || 0;
  const after = Math.max(0, sub - disc);
  const tax = after * (Number(t.taxRate) || 0) / 100;
  const grand = after + tax;

  const num = (DB.invoices.length + DB.returns.length + 1).toString().padStart(5, '0');
  pendingInvoice = {
    id: uid(),
    number: num,
    date: nowStr(),
    customer: t.customer || 'زائر',
    items: JSON.parse(JSON.stringify(t.items)),
    sub: sub,
    discount: disc,
    taxRate: Number(t.taxRate) || 0,
    tax: tax,
    total: grand,
    user: currentUser,
    paid: grand,
    remaining: 0,
    method: 'cash',
    status: 'paid'
  };
  document.getElementById('payTotal').textContent = fmt(grand);
  document.getElementById('payPaid').value = grand;
  document.getElementById('payMethod').value = 'cash';
  document.getElementById('partialBox').style.display = 'none';
  document.getElementById('payModal').classList.remove('hidden');
}

function confirmPay(){
  if(!pendingInvoice) return;
  const method = document.getElementById('payMethod').value;
  let paid = pendingInvoice.total;
  if(method === 'credit') paid = 0;
  if(method === 'partial') paid = Number(document.getElementById('payPaid').value) || 0;

  pendingInvoice.method = method;
  pendingInvoice.paid = paid;
  pendingInvoice.remaining = Math.max(0, pendingInvoice.total - paid);
  if(paid >= pendingInvoice.total) pendingInvoice.status = 'paid';
  else if(paid > 0) pendingInvoice.status = 'partial';
  else pendingInvoice.status = 'unpaid';

  pendingInvoice.items.forEach(it => {
    const p = DB.products.find(x => x.id === it.id);
    if(p) p.qty -= it.qty;
  });

  if(pendingInvoice.customer !== 'زائر' && pendingInvoice.remaining > 0){
    let c = DB.customers.find(x => x.name === pendingInvoice.customer);
    if(!c){
      c = { id: uid(), name: pendingInvoice.customer, phone: '', balance: 0 };
      DB.customers.push(c);
    }
    c.balance = (c.balance || 0) + pendingInvoice.remaining;
  }

  DB.invoices.push(pendingInvoice);
  lastInvoice = pendingInvoice;
  saveDB();

  const t = activeTab();
  if(t){
    tabs = tabs.filter(x => x.id !== t.id);
    activeTabId = tabs.length ? tabs[0].id : null;
  }
  if(!tabs.length) newTab();
  else { renderTabs(); renderCart(); }
  renderPOSProducts();
  refreshCategories();

  closeModal('payModal');
  beep();
  toast('تم البيع بنجاح ✅', 'success');

  if(DB.settings.autoPrint){
    printLast('thermal');
  }else{
    document.getElementById('printModal').classList.remove('hidden');
  }
}

// ============ الطباعة ============
function printLast(type){
  if(!lastInvoice) return;
  printInvoice(lastInvoice, type);
  closeModal('printModal');
}

function printInvoice(inv, type){
  type = type || 'normal';
  const s = DB.settings;
  const logoHTML = s.logo ?
    '<img src="' + s.logo + '" style="max-height:70px;display:block;margin:0 auto 8px;">' : '';
  const isThermal = type === 'thermal';
  const area = document.getElementById('printArea');
  area.style.width = isThermal ? '80mm' : '100%';

  let rows = '';
  inv.items.forEach((it, i) => {
    rows += '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + it.name + '</td>' +
      '<td>' + it.price.toFixed(2) + '</td>' +
      '<td>' + it.qty + '</td>' +
      '<td>' + (it.price * it.qty).toFixed(2) + '</td>' +
      '</tr>';
  });

  area.innerHTML =
    logoHTML +
    '<h2>' + s.storeName + '</h2>' +
    '<div class="info"' + (isThermal ? ' style="font-size:12px;text-align:center;"' : '') + '>' +
    '<div>هاتف: ' + (s.storePhone || '-') + '</div>' +
    '<div>' + (s.storeAddr || '-') + '</div>' +
    '<hr>' +
    '<div>فاتورة رقم: <b>' + inv.number + '</b></div>' +
    '<div>التاريخ: ' + new Date(inv.date).toLocaleString('ar-EG') + '</div>' +
    '<div>العميل: ' + inv.customer + '</div>' +
    '</div>' +
    '<table><thead><tr><th>#</th><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="totals">' +
    '<div>المجموع: ' + inv.sub.toFixed(2) + '</div>' +
    '<div>الخصم: ' + inv.discount.toFixed(2) + '</div>' +
    '<div>الضريبة: ' + inv.tax.toFixed(2) + '</div>' +
    '<div><b>الإجمالي: ' + inv.total.toFixed(2) + ' ' + s.currency + '</b></div>' +
    '<div>المدفوع: ' + (inv.paid || 0).toFixed(2) + '</div>' +
    (inv.remaining > 0 ? '<div>الباقي (دين): ' + inv.remaining.toFixed(2) + '</div>' : '') +
    '</div>' +
    '<p style="text-align:center;margin-top:20px;font-size:13px;">شكراً لتعاملكم معنا 🌟</p>';

  window.print();
}

// ============ ماسح الباركود USB ============
let barcodeBuffer = '';
let barcodeTimer = null;
let barcodeListenerActive = false;

function startBarcodeListener(){
  if(barcodeListenerActive) return;
  barcodeListenerActive = true;

  let status = document.getElementById('barcodeStatus');
  if(status){
    status.classList.add('active');
  }

  document.addEventListener('keypress', handleBarcodeKey);
}

function handleBarcodeKey(e){
  const active = document.activeElement;
  const isSearch = active && active.id === 'posSearch';
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
     active.tagName === 'SELECT') && !isSearch){
    return;
  }

  if(e.key === 'Enter' && barcodeBuffer.length > 3){
    e.preventDefault();
    const code = barcodeBuffer.trim();
    barcodeBuffer = '';
    lookupBarcode(code);
    return;
  }

  if(e.key.length === 1){
    barcodeBuffer += e.key;
    clearTimeout(barcodeTimer);
    barcodeTimer = setTimeout(() => { barcodeBuffer = ''; }, 300);
  }
}

function lookupBarcode(code){
  const p = DB.products.find(x => x.barcode === code);
  const status = document.getElementById('barcodeStatus');

  if(p){
    const posNav = document.querySelector('.nav-item[data-page="pos"]');
    if(posNav && !posNav.classList.contains('active')) posNav.click();
    addToCart(p);
    toast('✅ تمت إضافة: ' + p.name, 'success');
    beep();
    if(status){
      status.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + p.name + '</span>';
      status.style.background = '#10b981';
      setTimeout(() => {
        status.innerHTML = '<i class="fa-solid fa-barcode"></i> <span>الماسح جاهز</span>';
      }, 2000);
    }
  }else{
    toast('❌ باركود غير معروف: ' + code, 'error');
    if(status){
      status.innerHTML = '<i class="fa-solid fa-xmark"></i> <span>غير معروف</span>';
      status.style.background = '#ef4444';
      setTimeout(() => {
        status.innerHTML = '<i class="fa-solid fa-barcode"></i> <span>الماسح جاهز</span>';
        status.style.background = '#10b981';
      }, 2000);
    }
  }
}

function focusBarcodeInput(){
  const posNav = document.querySelector('.nav-item[data-page="pos"]');
  if(posNav && !posNav.classList.contains('active')) posNav.click();
  const inp = document.getElementById('posSearch');
  if(inp) inp.focus();
  toast('📷 الماسح جاهز — امسح المنتج الآن', 'info');
}

function genBarcode(){
  document.getElementById('pBarcode').value = 'P' + Date.now().toString().slice(-8);
}

function printBarcode(code, name){
  const area = document.getElementById('printArea');
  area.style.width = '100%';
  area.innerHTML = '<div style="text-align:center;padding:20px;">' +
    '<div style="font-weight:bold;margin-bottom:8px;">' + name + '</div>' +
    '<svg id="bcSvg"></svg>' +
    '</div>';
  try{
    JsBarcode('#bcSvg', code, { format: 'CODE128', width: 2, height: 60, displayValue: true });
    setTimeout(() => window.print(), 200);
  }catch(e){
    toast('تعذر توليد الباركود', 'error');
  }
}

// ============ المنتجات ============
let editingProductId = null;

function renderProducts(){
  const tbody = document.querySelector('#prodTable tbody');
  if(!tbody) return;
  const q = (document.getElementById('prodSearch').value || '').toLowerCase();
  tbody.innerHTML = '';
  DB.products
    .filter(p => !q || p.name.toLowerCase().indexOf(q) !== -1 || (p.barcode || '').indexOf(q) !== -1)
    .forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (p.barcode || '-') + '</td>' +
        '<td>' + p.name + '</td>' +
        '<td>' + (p.category || '-') + '</td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td>' + fmt(p.cost || 0) + '</td>' +
        '<td style="color:' + (p.qty <= DB.settings.lowStock ? '#ef4444' : '') + '">' + p.qty + '</td>' +
        '<td>' +
        '<button class="btn-icon view" onclick="printBarcode(\'' + (p.barcode || p.id) + '\',\'' + p.name.replace(/'/g, "\\'") + '\')" title="طباعة باركود"><i class="fa-solid fa-barcode"></i></button>' +
        '<button class="btn-icon edit" onclick="openProductModal(\'' + p.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn-icon del" onclick="deleteProduct(\'' + p.id + '\')"><i class="fa-solid fa-trash"></i></button>' +
        '</td>';
      tbody.appendChild(tr);
    });
}

function openProductModal(id){
  editingProductId = id || null;
  document.getElementById('prodModalTitle').textContent = id ? 'تعديل منتج' : 'منتج جديد';
  if(id){
    const p = DB.products.find(x => x.id === id);
    if(!p) return;
    document.getElementById('pName').value = p.name;
    document.getElementById('pBarcode').value = p.barcode || '';
    document.getElementById('pCategory').value = p.category || '';
    document.getElementById('pPrice').value = p.price;
    document.getElementById('pCost').value = p.cost || 0;
    document.getElementById('pQty').value = p.qty;
  }else{
    ['pName', 'pBarcode', 'pCategory'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('pPrice').value = '';
    document.getElementById('pCost').value = '0';
    document.getElementById('pQty').value = '0';
  }
  document.getElementById('productModal').classList.remove('hidden');
}

function saveProduct(){
  const name = document.getElementById('pName').value.trim();
  const price = Number(document.getElementById('pPrice').value);
  const qty = Number(document.getElementById('pQty').value);
  if(!name){ toast('اسم المنتج مطلوب', 'error'); return; }
  if(isNaN(price) || price < 0){ toast('السعر غير صالح', 'error'); return; }
  if(isNaN(qty) || qty < 0){ toast('الكمية غير صالحة', 'error'); return; }

  let barcode = document.getElementById('pBarcode').value.trim();
  if(!barcode) barcode = 'P' + Date.now().toString().slice(-8);

  const data = {
    name: name,
    price: price,
    qty: qty,
    barcode: barcode,
    cost: Number(document.getElementById('pCost').value) || 0,
    category: document.getElementById('pCategory').value.trim()
  };

  if(editingProductId){
    const p = DB.products.find(x => x.id === editingProductId);
    if(p) Object.assign(p, data);
  }else{
    DB.products.push(Object.assign({ id: uid() }, data));
  }
  saveDB();
  closeModal('productModal');
  renderProducts();
  renderPOSProducts();
  refreshCategories();
  toast('تم الحفظ', 'success');
}

function deleteProduct(id){
  if(!confirm('حذف المنتج؟')) return;
  DB.products = DB.products.filter(x => x.id !== id);
  saveDB();
  renderProducts();
  renderPOSProducts();
  refreshCategories();
  toast('تم الحذف', 'success');
}

// ============ المخزون ============
function renderInventory(){
  const total = DB.products.length;
  const low = DB.products.filter(p => p.qty > 0 && p.qty <= DB.settings.lowStock).length;
  const out = DB.products.filter(p => p.qty <= 0).length;
  let value = 0;
  DB.products.forEach(p => { value += (p.cost || 0) * p.qty; });

  document.getElementById('invTotal').textContent = total;
  document.getElementById('invLow').textContent = low;
  document.getElementById('invOut').textContent = out;
  document.getElementById('invValue').textContent = fmt(value);

  const tb = document.querySelector('#lowTable tbody');
  if(!tb) return;
  tb.innerHTML = '';
  const lowList = DB.products.filter(p => p.qty <= DB.settings.lowStock);
  if(!lowList.length){
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">لا توجد منتجات تحتاج تعبئة ✅</td></tr>';
    return;
  }
  lowList.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + p.name + '</td>' +
      '<td style="color:' + (p.qty <= 0 ? '#ef4444' : '#f59e0b') + '">' + p.qty + '</td>' +
      '<td>' + fmt(p.price) + '</td>' +
      '<td><input type="number" min="0" value="10" id="refill_' + p.id + '" style="width:70px;padding:5px;border-radius:6px;border:1px solid #ccc;"> ' +
      '<button class="btn-icon edit" onclick="refill(\'' + p.id + '\')" title="تعبئة"><i class="fa-solid fa-plus"></i></button></td>';
    tb.appendChild(tr);
  });
}

function refill(id){
  const inp = document.getElementById('refill_' + id);
  const v = Number(inp.value) || 0;
  const p = DB.products.find(x => x.id === id);
  if(p && v > 0){
    p.qty += v;
    saveDB();
    renderInventory();
    renderPOSProducts();
    toast('تمت التعبئة (+' + v + ')', 'success');
  }
}

// ============ العملاء ============
let editingCustomerId = null;

function renderCustomers(){
  const tbody = document.querySelector('#custTable tbody');
  if(!tbody) return;
  const q = (document.getElementById('custSearch').value || '').toLowerCase();
  tbody.innerHTML = '';
  DB.customers
    .filter(c => !q || c.name.toLowerCase().indexOf(q) !== -1 || (c.phone || '').indexOf(q) !== -1)
    .forEach(c => {
      const invs = DB.invoices.filter(i => i.customer === c.name);
      let total = 0;
      invs.forEach(i => { total += i.total; });
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + c.name + '</td>' +
        '<td>' + (c.phone || '-') + '</td>' +
        '<td>' + invs.length + '</td>' +
        '<td>' + fmt(total) + '</td>' +
        '<td style="color:' + ((c.balance || 0) > 0 ? '#ef4444' : '') + '">' + fmt(c.balance || 0) + '</td>' +
        '<td>' +
        '<button class="btn-icon view" onclick="showStatement(\'' + c.id + '\')" title="كشف حساب"><i class="fa-solid fa-file-lines"></i></button>' +
        '<button class="btn-icon edit" onclick="openCustomerModal(\'' + c.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn-icon del" onclick="deleteCustomer(\'' + c.id + '\')"><i class="fa-solid fa-trash"></i></button>' +
        '</td>';
      tbody.appendChild(tr);
    });
}

function openCustomerModal(id){
  editingCustomerId = id || null;
  document.getElementById('custModalTitle').textContent = id ? 'تعديل عميل' : 'عميل جديد';
  if(id){
    const c = DB.customers.find(x => x.id === id);
    if(!c) return;
    document.getElementById('cName').value = c.name;
    document.getElementById('cPhone').value = c.phone || '';
    document.getElementById('cBalance').value = c.balance || 0;
  }else{
    document.getElementById('cName').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cBalance').value = '0';
  }
  document.getElementById('customerModal').classList.remove('hidden');
}

function saveCustomer(){
  const name = document.getElementById('cName').value.trim();
  if(!name){ toast('الاسم مطلوب', 'error'); return; }
  const data = {
    name: name,
    phone: document.getElementById('cPhone').value.trim(),
    balance: Number(document.getElementById('cBalance').value) || 0
  };
  if(editingCustomerId){
    const c = DB.customers.find(x => x.id === editingCustomerId);
    if(c) Object.assign(c, data);
  }else{
    DB.customers.push(Object.assign({ id: uid() }, data));
  }
  saveDB();
  closeModal('customerModal');
  renderCustomers();
  refreshCategories();
  toast('تم الحفظ', 'success');
}

function deleteCustomer(id){
  if(!confirm('حذف العميل؟')) return;
  DB.customers = DB.customers.filter(x => x.id !== id);
  saveDB();
  renderCustomers();
  refreshCategories();
}

function showStatement(id){
  const c = DB.customers.find(x => x.id === id);
  if(!c) return;
  const invs = DB.invoices.filter(i => i.customer === c.name);
  let total = 0, paid = 0;
  invs.forEach(i => { total += i.total; paid += (i.paid || i.total); });

  let rows = '';
  invs.forEach(i => {
    rows += '<tr>' +
      '<td>' + i.number + '</td>' +
      '<td>' + new Date(i.date).toLocaleDateString('ar-EG') + '</td>' +
      '<td>' + i.total.toFixed(2) + '</td>' +
      '<td>' + (i.paid || i.total).toFixed(2) + '</td>' +
      '</tr>';
  });

  document.getElementById('statementBody').innerHTML =
    '<div style="margin-bottom:15px;">' +
    '<h3>' + c.name + '</h3>' +
    '<p>الهاتف: ' + (c.phone || '-') + '</p>' +
    '<p>عدد الفواتير: ' + invs.length + '</p>' +
    '<p>إجمالي الشراء: ' + fmt(total) + '</p>' +
    '<p>المدفوع: ' + fmt(paid) + '</p>' +
    '<p style="color:#ef4444;"><b>الدين الحالي: ' + fmt(c.balance || 0) + '</b></p>' +
    '</div>' +
    '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
    '<thead><tr style="background:#f1f5f9;"><th style="padding:8px;">#</th><th>التاريخ</th><th>الإجمالي</th><th>المدفوع</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="4" style="text-align:center;padding:10px;">لا توجد فواتير</td></tr>') + '</tbody>' +
    '</table>';
  document.getElementById('statementModal').classList.remove('hidden');
}

// ============ الديون ============
function renderDebts(){
  const debtors = DB.customers.filter(c => (c.balance || 0) > 0);
  let total = 0;
  debtors.forEach(c => { total += c.balance || 0; });
  document.getElementById('debtTotal').textContent = fmt(total);

  let paidSum = 0;
  DB.invoices.forEach(i => { paidSum += (i.paid || 0); });
  document.getElementById('debtPaid').textContent = fmt(paidSum);

  const tb = document.querySelector('#debtTable tbody');
  if(!tb) return;
  tb.innerHTML = '';
  if(!debtors.length){
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">لا توجد ديون ✅</td></tr>';
    return;
  }
  debtors.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + c.name + '</td>' +
      '<td>' + (c.phone || '-') + '</td>' +
      '<td style="color:#ef4444;font-weight:bold;">' + fmt(c.balance) + '</td>' +
      '<td>' +
      '<button class="btn-icon view" onclick="payDebt(\'' + c.id + '\')" title="تسديد"><i class="fa-solid fa-money-bill"></i></button>' +
      '<button class="btn-icon" onclick="showStatement(\'' + c.id + '\')" title="كشف حساب"><i class="fa-solid fa-file-lines"></i></button>' +
      '</td>';
    tb.appendChild(tr);
  });
}

function payDebt(id){
  const c = DB.customers.find(x => x.id === id);
  if(!c) return;
  const amount = prompt('الدين الحالي: ' + c.balance + '\nأدخل المبلغ المسدد:', c.balance);
  if(amount === null) return;
  const a = Number(amount);
  if(isNaN(a) || a <= 0){ toast('مبلغ غير صالح', 'error'); return; }
  c.balance = Math.max(0, (c.balance || 0) - a);
  saveDB();
  renderDebts();
  renderCustomers();
  toast('تم التسديد', 'success');
}

// ============ الفواتير ============
function renderInvoices(){
  const tbody = document.querySelector('#invTable tbody');
  if(!tbody) return;
  const from = document.getElementById('invFrom').value;
  const to = document.getElementById('invTo').value;
  const q = (document.getElementById('invSearch').value || '').toLowerCase();
  tbody.innerHTML = '';
  const list = DB.invoices.slice().reverse()
    .filter(i => !from || i.date.slice(0, 10) >= from)
    .filter(i => !to || i.date.slice(0, 10) <= to)
    .filter(i => !q || String(i.number).indexOf(q) !== -1 ||
                 i.customer.toLowerCase().indexOf(q) !== -1);

  if(!list.length){
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">لا توجد فواتير</td></tr>';
    return;
  }

  list.forEach(i => {
    const st = { paid: '✅ مدفوع', partial: '⚠️ جزئي', unpaid: '❌ دين' }[i.status || 'paid'];
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + i.number + '</td>' +
      '<td>' + new Date(i.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + i.customer + '</td>' +
      '<td>' + fmt(i.total) + '</td>' +
      '<td>' + fmt(i.paid || i.total) + '</td>' +
      '<td>' + fmt(i.remaining || 0) + '</td>' +
      '<td>' + st + '</td>' +
      '<td>' +
      '<button class="btn-icon print" onclick="printInvById(\'' + i.id + '\')" title="A4"><i class="fa-solid fa-print"></i></button>' +
      '<button class="btn-icon" onclick="printInvThermal(\'' + i.id + '\')" title="حراري"><i class="fa-solid fa-receipt"></i></button>' +
      (currentUser === 'admin' ? '<button class="btn-icon del" onclick="deleteInvoice(\'' + i.id + '\')"><i class="fa-solid fa-trash"></i></button>' : '') +
      '</td>';
    tbody.appendChild(tr);
  });
}

function printInvById(id){
  const inv = DB.invoices.find(x => x.id === id);
  if(inv) printInvoice(inv, 'normal');
}

function printInvThermal(id){
  const inv = DB.invoices.find(x => x.id === id);
  if(inv) printInvoice(inv, 'thermal');
}

function deleteInvoice(id){
  if(!confirm('حذف الفاتورة؟ سيتم إرجاع الكميات للمخزون.')) return;
  const inv = DB.invoices.find(x => x.id === id);
  if(!inv) return;
  inv.items.forEach(it => {
    const p = DB.products.find(x => x.id === it.id);
    if(p) p.qty += it.qty;
  });
  DB.invoices = DB.invoices.filter(x => x.id !== id);
  saveDB();
  renderInvoices();
  renderPOSProducts();
  toast('تم الحذف وإرجاع الكميات', 'success');
}

function resetInvFilters(){
  ['invFrom', 'invTo', 'invSearch'].forEach(i => {
    const el = document.getElementById(i);
    if(el) el.value = '';
  });
  renderInvoices();
}

// ============ المرتجعات ============
let pendingReturn = null;

function renderReturns(){
  const tbody = document.querySelector('#retTable tbody');
  if(!tbody) return;
  const q = (document.getElementById('retSearch').value || '').toLowerCase();
  tbody.innerHTML = '';
  const list = DB.returns.slice().reverse()
    .filter(r => !q || String(r.originalNumber).indexOf(q) !== -1);

  if(!list.length){
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">لا توجد مرتجعات</td></tr>';
    return;
  }

  list.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + r.number + '</td>' +
      '<td>' + r.originalNumber + '</td>' +
      '<td>' + new Date(r.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + fmt(r.total) + '</td>' +
      '<td>' + (r.reason || '-') + '</td>' +
      '<td><button class="btn-icon print" onclick="printReturn(\'' + r.id + '\')"><i class="fa-solid fa-print"></i></button></td>';
    tbody.appendChild(tr);
  });
}

function startReturn(){
  const num = document.getElementById('retInvNum').value.trim();
  const inv = DB.invoices.find(i => String(i.number) === num);
  if(!inv){ toast('لم يتم العثور على الفاتورة', 'error'); return; }
  pendingReturn = {
    invoice: inv,
    items: inv.items.map(i => Object.assign({}, i, { returnQty: 0 }))
  };

  let html = '';
  pendingReturn.items.forEach((it, i) => {
    html += '<div style="display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #eee;">' +
      '<span style="flex:1;">' + it.name + ' <small style="color:#666;">(مبيع: ' + it.qty + ')</small></span>' +
      '<input type="number" min="0" max="' + it.qty + '" value="0" ' +
      'onchange="pendingReturn.items[' + i + '].returnQty=Math.min(' + it.qty + ',Math.max(0,parseInt(this.value)||0))" ' +
      'style="width:80px;padding:5px;border-radius:6px;border:1px solid #ccc;">' +
      '</div>';
  });
  document.getElementById('returnItems').innerHTML = html;
  document.getElementById('returnReason').value = '';
  document.getElementById('returnModal').classList.remove('hidden');
}

function confirmReturn(){
  if(!pendingReturn) return;
  const items = pendingReturn.items.filter(i => i.returnQty > 0);
  if(!items.length){ toast('لم تحدد أي منتجات للإرجاع', 'warn'); return; }

  let total = 0;
  items.forEach(i => { total += i.price * i.returnQty; });
  const reason = document.getElementById('returnReason').value.trim();

  const ret = {
    id: uid(),
    number: 'R' + (DB.returns.length + 1).toString().padStart(5, '0'),
    originalNumber: pendingReturn.invoice.number,
    originalId: pendingReturn.invoice.id,
    date: nowStr(),
    items: items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.returnQty })),
    total: total,
    reason: reason
  };

  items.forEach(i => {
    const p = DB.products.find(x => x.id === i.id);
    if(p) p.qty += i.returnQty;
  });

  DB.returns.push(ret);

  const cust = DB.customers.find(c => c.name === pendingReturn.invoice.customer);
  if(cust) cust.balance = Math.max(0, (cust.balance || 0) - total);

  saveDB();
  closeModal('returnModal');
  toast('تم المرتجع ✅', 'success');
  renderReturns();
  renderProducts();
  renderPOSProducts();
  document.getElementById('retInvNum').value = '';
}

function printReturn(id){
  const r = DB.returns.find(x => x.id === id);
  if(!r) return;
  const area = document.getElementById('printArea');
  area.style.width = '100%';
  let rows = '';
  r.items.forEach(i => {
    rows += '<tr><td>' + i.name + '</td><td>' + i.price.toFixed(2) + '</td>' +
      '<td>' + i.qty + '</td><td>' + (i.price * i.qty).toFixed(2) + '</td></tr>';
  });
  area.innerHTML =
    '<h2>مرتجع - ' + DB.settings.storeName + '</h2>' +
    '<div class="info">' +
    '<div>رقم المرتجع: ' + r.number + '</div>' +
    '<div>الفاتورة الأصلية: ' + r.originalNumber + '</div>' +
    '<div>التاريخ: ' + new Date(r.date).toLocaleString('ar-EG') + '</div>' +
    '<div>السبب: ' + (r.reason || '-') + '</div>' +
    '</div>' +
    '<table><thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="totals"><b>الإجمالي المرتجع: ' + r.total.toFixed(2) + '</b></div>';
  window.print();
}

// ============ المصروفات ============
function openExpenseModal(){
  document.getElementById('eDesc').value = '';
  document.getElementById('eAmount').value = '';
  document.getElementById('expenseModal').classList.remove('hidden');
}

function saveExpense(){
  const amount = Number(document.getElementById('eAmount').value);
  if(isNaN(amount) || amount <= 0){ toast('مبلغ غير صالح', 'error'); return; }
  DB.expenses.push({
    id: uid(),
    date: nowStr(),
    type: document.getElementById('eType').value,
    desc: document.getElementById('eDesc').value.trim(),
    amount: amount
  });
  saveDB();
  closeModal('expenseModal');
  renderExpenses();
  toast('تم الحفظ', 'success');
}

function renderExpenses(){
  const tbody = document.querySelector('#expTable tbody');
  if(!tbody) return;
  const now = new Date();
  const monthInput = document.getElementById('expMonth');
  let month = monthInput.value;
  if(!month){
    month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    monthInput.value = month;
  }

  const filtered = DB.expenses.filter(e => e.date.slice(0, 7) === month);
  let total = 0;
  filtered.forEach(e => { total += e.amount; });

  document.getElementById('expMonthTotal').textContent = fmt(total);
  document.getElementById('expCount').textContent = filtered.length;

  tbody.innerHTML = '';
  if(!filtered.length){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">لا توجد مصروفات هذا الشهر</td></tr>';
    return;
  }
  filtered.slice().reverse().forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + new Date(e.date).toLocaleDateString('ar-EG') + '</td>' +
      '<td>' + e.type + '</td>' +
      '<td>' + (e.desc || '-') + '</td>' +
      '<td>' + fmt(e.amount) + '</td>' +
      '<td><button class="btn-icon del" onclick="deleteExpense(\'' + e.id + '\')"><i class="fa-solid fa-trash"></i></button></td>';
    tbody.appendChild(tr);
  });
}

function deleteExpense(id){
  if(!confirm('حذف المصروف؟')) return;
  DB.expenses = DB.expenses.filter(x => x.id !== id);
  saveDB();
  renderExpenses();
}

// ============ الإحصائيات ============
let chart7 = null;
let chartTop = null;

function renderStats(){
  const from = document.getElementById('stFrom').value;
  const to = document.getElementById('stTo').value;
  const invs = DB.invoices.filter(i =>
    (!from || i.date.slice(0, 10) >= from) &&
    (!to || i.date.slice(0, 10) <= to)
  );

  let sales = 0, cost = 0;
  invs.forEach(i => {
    sales += i.total;
    i.items.forEach(it => { cost += (it.cost || 0) * it.qty; });
  });

  let returns = 0;
  DB.returns
    .filter(r => (!from || r.date.slice(0, 10) >= from) && (!to || r.date.slice(0, 10) <= to))
    .forEach(r => { returns += r.total; });

  document.getElementById('stSales').textContent = fmt(sales);
  document.getElementById('stCount').textContent = invs.length;
  document.getElementById('stAvg').textContent = invs.length ? fmt(sales / invs.length) : fmt(0);
  document.getElementById('stCost').textContent = fmt(cost);
  document.getElementById('stProfit').textContent = fmt(sales - cost - returns);
  document.getElementById('stReturns').textContent = fmt(returns);

  const map = {};
  invs.forEach(inv => {
    inv.items.forEach(it => {
      if(!map[it.name]) map[it.name] = { qty: 0, rev: 0, profit: 0 };
      map[it.name].qty += it.qty;
      map[it.name].rev += it.qty * it.price;
      map[it.name].profit += it.qty * (it.price - (it.cost || 0));
    });
  });
  const top = Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
  const tb = document.querySelector('#topTable tbody');
  tb.innerHTML = top.map(([n, d]) =>
    '<tr><td>' + n + '</td><td>' + d.qty + '</td>' +
    '<td>' + fmt(d.rev) + '</td><td>' + fmt(d.profit) + '</td></tr>'
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:#888;">لا توجد بيانات</td></tr>';
}

// ============ لوحة التحكم ============
function renderDashboard(){
  const today = todayStr();
  const todayInvs = DB.invoices.filter(i => i.date.slice(0, 10) === today);
  let todaySales = 0;
  todayInvs.forEach(i => { todaySales += i.total; });

  document.getElementById('dbSales').textContent = fmt(todaySales);
  document.getElementById('dbInvoices').textContent = todayInvs.length;
  document.getElementById('dbCustomers').textContent = DB.customers.length;
  document.getElementById('dbLowStock').textContent =
    DB.products.filter(p => p.qty <= DB.settings.lowStock).length;

  const tbody = document.querySelector('#recentInv tbody');
  if(tbody){
    const recent = DB.invoices.slice(-8).reverse();
    tbody.innerHTML = recent.length ? recent.map(i =>
      '<tr><td>' + i.number + '</td><td>' + i.customer + '</td>' +
      '<td>' + fmt(i.total) + '</td>' +
      '<td>' + new Date(i.date).toLocaleDateString('ar-EG') + '</td></tr>'
    ).join('') : '<tr><td colspan="4" style="text-align:center;color:#888;">لا توجد فواتير</td></tr>';
  }

  const labels = [], data = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    labels.push(ds.slice(5));
    let dayTotal = 0;
    DB.invoices.filter(x => x.date.slice(0, 10) === ds)
      .forEach(x => { dayTotal += x.total; });
    data.push(dayTotal);
  }

  const ctx1 = document.getElementById('chart7days');
  if(ctx1 && typeof Chart !== 'undefined'){
    if(chart7) chart7.destroy();
    chart7 = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'المبيعات',
          data: data,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79,70,229,.15)',
          fill: true,
          tension: .3
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  const map = {};
  DB.invoices.forEach(inv => {
    inv.items.forEach(it => {
      map[it.name] = (map[it.name] || 0) + it.qty;
    });
  });
  const top = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const ctx2 = document.getElementById('chartTop');
  if(ctx2 && typeof Chart !== 'undefined'){
    if(chartTop) chartTop.destroy();
    chartTop = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: top.map(x => x[0]),
        datasets: [{ label: 'الكمية', data: top.map(x => x[1]), backgroundColor: '#10b981' }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        indexAxis: 'y'
      }
    });
  }
}

// ============ التقارير ============
function printReport(type){
  const area = document.getElementById('printArea');
  area.style.width = '100%';
  if(type === 'invoices'){
    let rows = '';
    DB.invoices.forEach(i => {
      rows += '<tr><td>' + i.number + '</td>' +
        '<td>' + new Date(i.date).toLocaleDateString('ar-EG') + '</td>' +
        '<td>' + i.customer + '</td>' +
        '<td>' + i.total.toFixed(2) + '</td></tr>';
    });
    let total = 0;
    DB.invoices.forEach(i => { total += i.total; });
    area.innerHTML =
      '<h2>تقرير الفواتير - ' + DB.settings.storeName + '</h2>' +
      '<p>التاريخ: ' + new Date().toLocaleString('ar-EG') + '</p>' +
      '<table><thead><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4">لا توجد فواتير</td></tr>') + '</tbody></table>' +
      '<p><b>الإجمالي: ' + total.toFixed(2) + ' ' + DB.settings.currency + '</b></p>';
  }else{
    let sales = 0, cost = 0;
    DB.invoices.forEach(i => {
      sales += i.total;
      i.items.forEach(it => { cost += (it.cost || 0) * it.qty; });
    });
    area.innerHTML =
      '<h2>تقرير الإحصائيات - ' + DB.settings.storeName + '</h2>' +
      '<p>التاريخ: ' + new Date().toLocaleString('ar-EG') + '</p>' +
      '<p>إجمالي المبيعات: ' + sales.toFixed(2) + '</p>' +
      '<p>عدد الفواتير: ' + DB.invoices.length + '</p>' +
      '<p>التكلفة: ' + cost.toFixed(2) + '</p>' +
      '<p><b>صافي الربح: ' + (sales - cost).toFixed(2) + '</b></p>';
  }
  window.print();
}

// ============ المستخدمون ============
function loadUsersForm(){
  document.getElementById('passwordsEnabled').checked = DB.settings.passwordsEnabled;
  document.getElementById('pwdAdmin').value = '';
  document.getElementById('pwdEmp').value = '';
  document.getElementById('pwdStock').value = '';
  document.getElementById('securityQuestion').value = DB.settings.securityQuestion || '';
  document.getElementById('securityAnswer').value = '';
  document.getElementById('recoveryCode').value = DB.settings.recoveryContact || '';

  const status = document.getElementById('securityStatus');
  if(DB.settings.securityQuestion && DB.settings.securityAnswer && DB.settings.recoveryContact){
    status.innerHTML = '✅ بيانات الاستعادة مُعدّة';
    status.style.color = '#10b981';
  }else{
    status.innerHTML = '⚠️ بيانات الاستعادة غير مكتملة';
    status.style.color = '#f59e0b';
  }
}

function togglePasswords(){
  const enabled = document.getElementById('passwordsEnabled').checked;

  if(enabled && !DB.settings.adminPass && !document.getElementById('pwdAdmin').value.trim()){
    toast('⚠️ عيّن كلمة مرور للمدير أولاً', 'error');
    document.getElementById('passwordsEnabled').checked = false;
    return;
  }

  DB.settings.passwordsEnabled = enabled;
  saveDB();
  toast(enabled ? '✅ تم تفعيل كلمات المرور' : 'تم تعطيل كلمات المرور', 'success');
}

function savePasswords(){
  let changed = 0;
  const a = document.getElementById('pwdAdmin').value.trim();
  const e = document.getElementById('pwdEmp').value.trim();
  const s = document.getElementById('pwdStock').value.trim();

  if(a){
    if(a.length < 3){ toast('كلمة مرور المدير قصيرة', 'error'); return; }
    DB.settings.adminPass = a;
    changed++;
  }
  if(e){
    if(e.length < 3){ toast('كلمة مرور الكاشير قصيرة', 'error'); return; }
    DB.settings.empPass = e;
    changed++;
  }
  if(s){
    if(s.length < 3){ toast('كلمة مرور المخزون قصيرة', 'error'); return; }
    DB.settings.stockPass = s;
    changed++;
  }

  if(changed === 0){
    toast('⚠️ لم تُدخل أي كلمة مرور جديدة', 'warn');
    return;
  }

  saveDB();
  toast('✅ تم حفظ ' + changed + ' كلمة مرور', 'success');
  document.getElementById('pwdAdmin').value = '';
  document.getElementById('pwdEmp').value = '';
  document.getElementById('pwdStock').value = '';
}

function saveSecurity(){
  const q = document.getElementById('securityQuestion').value.trim();
  const a = document.getElementById('securityAnswer').value.trim();
  const rec = document.getElementById('recoveryCode').value.trim();

  if(!q){ toast('سؤال الأمان مطلوب', 'error'); return; }
  if(!rec){ toast('رقم/بريد الاستعادة مطلوب', 'error'); return; }

  DB.settings.securityQuestion = q;
  DB.settings.recoveryContact = rec;

  if(a){
    DB.settings.securityAnswer = a.toLowerCase();
  }

  if(!DB.settings.securityAnswer){
    toast('⚠️ يجب إدخال جواب سؤال الأمان', 'error');
    return;
  }

  saveDB();
  document.getElementById('securityAnswer').value = '';
  loadUsersForm();
  toast('✅ تم حفظ بيانات الاستعادة', 'success');
}

function resetPasswords(){
  if(!confirm('سيتم مسح كل كلمات المرور وإعادة الدخول المباشر. متأكد؟')) return;
  DB.settings.adminPass = '';
  DB.settings.empPass = '';
  DB.settings.stockPass = '';
  DB.settings.passwordsEnabled = false;
  saveDB();
  document.getElementById('passwordsEnabled').checked = false;
  document.getElementById('pwdAdmin').value = '';
  document.getElementById('pwdEmp').value = '';
  document.getElementById('pwdStock').value = '';
  toast('✅ تم إعادة التعيين', 'success');
}

function togglePwd(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ============ الإعدادات ============
function loadSettingsForm(){
  const s = DB.settings;
  document.getElementById('setStoreName').value = s.storeName;
  document.getElementById('setStorePhone').value = s.storePhone;
  document.getElementById('setStoreAddr').value = s.storeAddr;
  document.getElementById('setCurrency').value = s.currency;
  document.getElementById('setDarkMode').checked = s.darkMode;
  document.getElementById('setAutoPrint').checked = s.autoPrint;
  document.getElementById('setSound').checked = s.sound;
  document.getElementById('setLowStock').value = s.lowStock;
  document.getElementById('setTax').value = s.taxRate;
  const prev = document.getElementById('logoPreview');
  if(prev && s.logo){
    prev.innerHTML = '<img src="' + s.logo + '" style="max-height:80px;border-radius:8px;">';
  }
}

function saveStore(){
  const s = DB.settings;
  s.storeName = document.getElementById('setStoreName').value.trim() || 'متجري';
  s.storePhone = document.getElementById('setStorePhone').value.trim();
  s.storeAddr = document.getElementById('setStoreAddr').value.trim();
  s.currency = document.getElementById('setCurrency').value.trim() || 'ر.س';
  saveDB();
  applyBranding();
  toast('تم حفظ البيانات', 'success');
}

function savePrefs(){
  const s = DB.settings;
  s.darkMode = document.getElementById('setDarkMode').checked;
  s.autoPrint = document.getElementById('setAutoPrint').checked;
  s.sound = document.getElementById('setSound').checked;
  s.lowStock = Number(document.getElementById('setLowStock').value) || 5;
  s.taxRate = Number(document.getElementById('setTax').value) || 0;
  saveDB();
  applyPrefs();
  toast('تم الحفظ', 'success');
}

function applyPrefs(){
  document.body.classList.toggle('dark', DB.settings.darkMode);
}

function applyBranding(){
  const nameEl = document.getElementById('brandName');
  if(nameEl) nameEl.textContent = DB.settings.storeName;
  const img = document.getElementById('storeLogoImg');
  const icon = document.getElementById('storeLogoIcon');
  if(img && icon){
    if(DB.settings.logo){
      img.src = DB.settings.logo;
      img.classList.remove('hidden');
      icon.style.display = 'none';
    }else{
      img.classList.add('hidden');
      icon.style.display = '';
    }
  }
  const loginTitle = document.getElementById('loginTitle');
  const loginSub = document.getElementById('loginSub');
  if(loginTitle) loginTitle.textContent = DB.settings.storeName;
  if(loginSub) loginSub.textContent = 'نظام إدارة المبيعات الاحترافي';
}

function bindLogoUpload(){
  const inp = document.getElementById('setLogo');
  if(!inp) return;
  inp.addEventListener('change', e => {
    const f = e.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = ev => {
      DB.settings.logo = ev.target.result;
      saveDB();
      applyBranding();
      const prev = document.getElementById('logoPreview');
      if(prev) prev.innerHTML = '<img src="' + ev.target.result + '" style="max-height:80px;border-radius:8px;">';
      toast('تم رفع الشعار', 'success');
    };
    r.readAsDataURL(f);
  });
}

// ============ النسخ الاحتياطي ============
function exportBackup(){
  const data = JSON.stringify(DB, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = 'backup_' + date + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('تم تنزيل النسخة', 'success');
}

async function restoreBackup(){
  const f = document.getElementById('restoreFile').files[0];
  if(!f){ toast('اختر ملفاً', 'warn'); return; }
  if(!confirm('سيتم استبدال كل البيانات الحالية. متأكد؟')) return;

  try{
    const text = await f.text();
    const d = JSON.parse(text);
    if(!d.products || !d.settings) throw new Error('ملف غير صالح');

    if(!d.invoices) d.invoices = [];
    if(!d.returns) d.returns = [];
    if(!d.customers) d.customers = [];
    if(!d.expenses) d.expenses = [];

    DB = Object.assign(DB, d);
    DB.settings = Object.assign({
      storeName: 'متجري', storePhone: '', storeAddr: '', currency: 'ر.س',
      logo: '', passwordsEnabled: false, adminPass: '', empPass: '', stockPass: '',
      securityQuestion: '', securityAnswer: '', recoveryContact: '',
      darkMode: false, autoPrint: false, sound: true, lowStock: 5, taxRate: 0
    }, d.settings);

    await saveDB();
    toast('✅ تمت الاستعادة بنجاح', 'success');
    setTimeout(() => location.reload(), 800);
  }catch(e){
    toast('❌ فشل: ' + e.message, 'error');
  }
}

function exportCSV(){
  let csv = 'رقم,التاريخ,العميل,الإجمالي,المدفوع,الباقي,الحالة\n';
  DB.invoices.forEach(i => {
    const st = { paid: 'مدفوع', partial: 'جزئي', unpaid: 'دين' }[i.status || 'paid'];
    csv += i.number + ',' + i.date + ',' + i.customer + ',' +
      i.total.toFixed(2) + ',' + (i.paid || 0).toFixed(2) + ',' +
      (i.remaining || 0).toFixed(2) + ',' + st + '\n';
  });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'invoices_' + todayStr() + '.csv';
  a.click();
  toast('تم التصدير', 'success');
}

async function wipeAll(){
  if(!confirm('⚠️ سيتم مسح كل شيء! متأكد؟')) return;
  if(!confirm('تأكيد نهائي؟ لا يمكن التراجع.')) return;
  const settings = DB.settings;
  DB = {
    products: [], invoices: [], returns: [], customers: [], expenses: [],
    settings: settings
  };
  await saveDB();
  toast('تم المسح', 'success');
  setTimeout(() => location.reload(), 800);
}

// ============ اختصارات ============
function bindKeyboardShortcuts(){
  document.addEventListener('keydown', e => {
    const app = document.getElementById('app');
    if(!app || app.classList.contains('hidden')) return;

    if(e.key === 'F2'){
      e.preventDefault();
      const nav = document.querySelector('.nav-item[data-page="pos"]');
      if(nav) nav.click();
      setTimeout(() => {
        const inp = document.getElementById('posSearch');
        if(inp) inp.focus();
      }, 100);
    }
    if(e.key === 'F3'){
      e.preventDefault();
      const nav = document.querySelector('.nav-item[data-page="pos"]');
      if(nav) nav.click();
      setTimeout(() => newTab(), 100);
    }
    if(e.key === 'F4'){
      e.preventDefault();
      const inp = document.getElementById('cartCustomer');
      if(inp) inp.focus();
    }
    if(e.key === 'F9'){
      e.preventDefault();
      checkout();
    }
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    }
  });
}

// ============ التهيئة ============
async function initAll(){
  refreshCategories();
  renderPOSProducts();
  loadOpenTabs();
  renderTabs();
  renderCart();
  loadSettingsForm();
  bindCartInputs();
  bindKeyboardShortcuts();
  bindLogoUpload();
  initNavigation();

  if(DB.settings.darkMode) document.body.classList.add('dark');

  const inputs = [
    ['posSearch', renderPOSProducts],
    ['prodSearch', renderProducts],
    ['custSearch', renderCustomers],
    ['invSearch', renderInvoices],
    ['retSearch', renderReturns],
    ['invFrom', renderInvoices],
    ['invTo', renderInvoices],
    ['expMonth', renderExpenses],
    ['posCategory', renderPOSProducts],
    ['stFrom', renderStats],
    ['stTo', renderStats]
  ];
  inputs.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', fn);
  });

  // إعداد مستمع تغيير الدور في الاستعادة
  const recRole = document.getElementById('recRole');
  if(recRole) recRole.addEventListener('change', updateRecoveryQuestion);

  // معرّف الجهاز
  const dv = document.getElementById('deviceIdView');
  if(dv) dv.textContent = window.DEVICE_ID || 'unknown';
}

// ============ التشغيل ============
document.addEventListener('DOMContentLoaded', async () => {
  await openIDB();
  await loadDB();

  applyBranding();

  if(DB.settings.passwordsEnabled &&
     (DB.settings.adminPass || DB.settings.empPass || DB.settings.stockPass)){
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginPass').addEventListener('keydown', e => {
      if(e.key === 'Enter') tryLogin();
    });
    document.getElementById('loginPass').focus();
  }else{
    enterAppDirectly();
    initAll();
    startBarcodeListener();
  }

  window.addEventListener('online', () => {
    updateSyncStatus();
    if(syncEnabled && fbReady) pushToCloud(true);
  });
  window.addEventListener('offline', updateSyncStatus);
});

setInterval(() => { saveOpenTabs(); saveDB(); }, 20000);

window.addEventListener('beforeunload', () => {
  saveOpenTabs();
  saveDB();
});