// ==========================================================================
// 1. CORE LOGIC & STATE 
// ==========================================================================
const GOOGLE_CALENDAR_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzM6uF01goN2oNrWAIKal_FB-m-AuPUiBSnQbohr5XLR_AaKt5bTY8hQZN9RmYIrq-6/exec?tab=Daily"; 
const QOTD_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTHBPh45e_R7clf_hx3j3OLJP1ThFEBlDIu4OLyt4tTEDZg6_xImwzO08bE0JzG_ezlQ/exec";
const DEFAULT_PREFS = { open: false, putaway: false, attendance: false, cleanup: false, retrieve: false, icalUrl: '' };
const SAVE_KEY = 'waltonSettingsV3'; 

const GOODBYE_MESSAGES = [
    "Great work today. Have a wonderful rest of your day.",
    "Class is dismissed. Keep up the fantastic effort!",
    "Thank you for your hard work today. See you next time.",
    "Have a great day, and make good choices!",
    "Class is over. I hope you have a fantastic afternoon.",
    "Thanks for a great class. Stay curious and keep learning.",
    "You all did great today. Have a safe and happy afternoon.",
    "Class dismissed. Remember to be kind to one another.",
    "Excellent effort today. Have a beautiful rest of your day."
];

const playSVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const pauseSVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

let isBooting = true; 

let activeSchedule = []; 
let currentScheduleName = "Loading..."; 
let globalVolume = 1.0, globalVoicePref = '', classSettings = {};
let lunchDuties = [], customReminders = [];
let savedVibes = [], currentVibeUrl = '', vibeVolume = 50;

let isWaffleClosed = true, isMinimalView = false; 
let currentTestSound = 'positive', sidebarVisible = false, isDarkMode = false, showZero = false;
let playGoodbyes = false, muteBells = false;

let accordionStates = { 'sec-audio': true, 'sec-reminders': true, 'sec-vibe': true, 'sec-schedule': true };
let activeWidgets = { weather: true, timer: false, qotd: true, spacer1: false, spacer2: false }; 

let layoutNormal = [];
let layoutFocus = [];

let timerInterval = null, timerTotalSeconds = 300, timerIsPlaying = false;
let playedActions = {}, currentMinuteTracker = "", lastAutoState = null; 
let mrBsJukebox = false, jukeboxUrl = "https://www.youtube.com/watch?v=CLLpSmaof4E"; 
let isMainVibePlaying = false, activePlayerUrl = '', lastPeriodStatus = null; 

let agendaCache = {}, agendaPromises = {};
let savedVibeVol = 50, isVibeMuted = false, savedGlobalVol = 1.0, isGlobalMuted = false;

// ==========================================================================
// 2. MAGNETIC GRID SYSTEM (Drag, Drop & Height Memory)
// ==========================================================================
function initWidgets() {
    const masterGrid = document.getElementById('master-grid');
    if (!masterGrid) return;
    let draggedWidget = null;

    document.querySelectorAll('.widget-drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            const widget = e.target.closest('.widget-card');
            if(widget) widget.setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', (e) => {
            const widget = e.target.closest('.widget-card');
            if(widget) widget.removeAttribute('draggable');
        });
    });

    document.querySelectorAll('.widget-card').forEach(widget => {
        widget.addEventListener('dragstart', (e) => {
            draggedWidget = widget;
            setTimeout(() => widget.classList.add('is-dragging'), 0);
        });
        
        widget.addEventListener('dragend', () => {
            if(draggedWidget) draggedWidget.classList.remove('is-dragging');
            widget.removeAttribute('draggable');
            document.querySelectorAll('.widget-card').forEach(w => w.classList.remove('drag-over'));
            draggedWidget = null;
            saveLayout(); 
        });

        widget.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedWidget || draggedWidget === widget) return;
            widget.classList.add('drag-over');
        });

        widget.addEventListener('dragleave', (e) => {
            widget.classList.remove('drag-over');
        });

        widget.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedWidget || draggedWidget === widget) return;
            widget.classList.remove('drag-over');
            
            const allWidgets = [...masterGrid.querySelectorAll('.widget-card')];
            const draggedIndex = allWidgets.indexOf(draggedWidget);
            const targetIndex = allWidgets.indexOf(widget);
            
            if (draggedIndex < targetIndex) {
                widget.after(draggedWidget);
            } else {
                masterGrid.insertBefore(draggedWidget, widget);
            }
        });

        widget.addEventListener('mouseup', (e) => {
            if (!isMinimalView && !draggedWidget) {
                saveLayout();
            }
        });
    });
}

function saveLayout() {
    if (isBooting) return;
    const grid = document.getElementById('master-grid');
    if (!grid) return;

    const widgets = Array.from(grid.querySelectorAll('.widget-card'));
    const currentLayout = widgets.map(el => {
        return { id: el.id, height: el.style.height }; 
    });

    if (isMinimalView) layoutFocus = currentLayout;
    else layoutNormal = currentLayout;
    
    saveLocalSettings();
}

function applyLayout() {
    const activeLayout = isMinimalView ? layoutFocus : layoutNormal;
    const grid = document.getElementById('master-grid');
    if (!grid || !activeLayout || activeLayout.length === 0) return;

    activeLayout.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            if (item.height && !isMinimalView) {
                el.style.height = item.height;
            } else if (isMinimalView) {
                el.style.height = 'auto'; 
            }
            grid.appendChild(el); 
        }
    });
}

// ==========================================================================
// 3. AUDIO, VOICES, AND REMINDERS
// ==========================================================================
let availableVoices = [];

function safePopulateVoiceList() {
    if (!('speechSynthesis' in window)) return;
    let voices = window.speechSynthesis.getVoices();
    
    if (voices.length === 0) {
        setTimeout(safePopulateVoiceList, 500);
        return;
    }
    
    availableVoices = voices;
    const select = document.getElementById('voicePreference');
    if (!select) return;
    
    select.innerHTML = '';
    availableVoices.forEach((voice) => {
        const opt = document.createElement('option');
        opt.value = voice.name;
        opt.textContent = `${voice.name} (${voice.lang})`;
        if (voice.name === globalVoicePref) opt.selected = true;
        select.appendChild(opt);
    });
    if (!globalVoicePref && availableVoices.length > 0) {
        globalVoicePref = availableVoices[0].name;
        saveLocalSettings();
    }
}

function changeVoicePref() {
    const select = document.getElementById('voicePreference');
    if (select) {
        globalVoicePref = select.value;
        saveLocalSettings();
        speak("Voice updated.");
    }
}

function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = globalVolume;
    if (globalVoicePref) {
        const voice = availableVoices.find(v => v.name === globalVoicePref);
        if (voice) utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
}

function playBellWithQueue(rings, callback) {
    if (muteBells && callback) { callback(); return; }
    if (muteBells) return;
    const bell = document.getElementById('regularBellAudio');
    if (!bell) { if(callback) callback(); return; }
    let count = 0;
    bell.volume = globalVolume;
    const playNext = () => {
        if (count < rings) {
            count++;
            bell.currentTime = 0;
            bell.play().catch(e => console.log(e));
        } else {
            bell.removeEventListener('ended', playNext);
            if (callback) callback();
        }
    };
    bell.addEventListener('ended', playNext);
    playNext();
}

function toggleDropdown(e) {
    if(e) e.stopPropagation();
    document.getElementById("soundDropdown").classList.toggle("show");
}

function selectTestSound(id, name) {
    currentTestSound = id;
    document.getElementById("playBtn").innerHTML = "▶ Play " + name;
    saveLocalSettings();
}

function testSelectedSound() {
    if (currentTestSound === 'positive') speak("Testing voice output. Have a great day!");
    else if (currentTestSound === 'start') playBellWithQueue(3, () => speak("Class is beginning."));
    else if (currentTestSound === 'end') playBellWithQueue(3, () => { if(playGoodbyes) speak(GOODBYE_MESSAGES[0]); });
    else if (currentTestSound === 'warning1m') playBellWithQueue(1, () => speak("One minute until class begins."));
    else if (currentTestSound === 'attendance') speak("Reminder. Please take attendance.");
    else if (currentTestSound === 'cleanup') speak("Five minutes remaining. Please begin cleaning up your area.");
    else if (currentTestSound === 'lunch') speak("Reminder. You have lunch duty today.");
}

function toggleGoodbyes() {
    const el = document.getElementById('playGoodbyes');
    playGoodbyes = el ? el.checked : false;
    saveLocalSettings();
}

function toggleMuteBells() {
    const el = document.getElementById('muteBellsToggle');
    muteBells = el ? el.checked : false;
    saveLocalSettings();
}

function addCustomReminder() {
    const name = document.getElementById('remName').value;
    const time = document.getElementById('remTime').value;
    const day = document.getElementById('remDay').value;
    if(!name || !time) return showToast("Please enter a name and time.");
    customReminders.push({ name, time, day });
    document.getElementById('remName').value = '';
    document.getElementById('remTime').value = '';
    saveLocalSettings();
    renderCustomReminders();
    showToast("Reminder added");
}

function removeCustomReminder(index) {
    customReminders.splice(index, 1);
    saveLocalSettings();
    renderCustomReminders();
}

function renderCustomReminders() {
    const list = document.getElementById('custom-reminder-list');
    if(!list) return;
    list.innerHTML = '';
    const days = {"All": "Daily", "1":"Mon", "2":"Tue", "3":"Wed", "4":"Thu", "5":"Fri"};
    customReminders.forEach((r, i) => {
        const li = document.createElement('li');
        li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.marginBottom = '4px';
        li.innerHTML = `<span><b>${formatTime12(r.time)}</b> - ${r.name} (${days[r.day]})</span> <button style="background:none;border:none;color:#d9534f;cursor:pointer;" onclick="removeCustomReminder(${i})">✖</button>`;
        list.appendChild(li);
    });
}

function addLunchDuty() {
    const day = document.getElementById('lunchDay').value;
    const half = document.getElementById('lunchHalf').value;
    const period = document.getElementById('lunchPeriod').value;
    lunchDuties.push({ day: parseInt(day), half: parseInt(half), period: period });
    saveLocalSettings();
    renderLunchDuties();
    showToast("Lunch duty added");
}

function removeLunchDuty(index) {
    lunchDuties.splice(index, 1);
    saveLocalSettings();
    renderLunchDuties();
}

function renderLunchDuties() {
    const list = document.getElementById('lunch-duty-list');
    if(!list) return;
    list.innerHTML = '';
    const days = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
    lunchDuties.forEach((d, i) => {
        const li = document.createElement('li');
        li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.marginBottom = '4px';
        li.innerHTML = `<span><b>${days[d.day]}</b> - ${d.period} (${d.half === 1 ? '1st' : '2nd'} Half)</span> <button style="background:none;border:none;color:#d9534f;cursor:pointer;" onclick="removeLunchDuty(${i})">✖</button>`;
        list.appendChild(li);
    });
}

function toggleJukebox() {
    const el = document.getElementById('jukeboxToggle');
    mrBsJukebox = el ? el.checked : false;
    saveLocalSettings();
}

function updateJukeboxUrl() {
    const el = document.getElementById('jukeboxUrlInput');
    if (el) {
        jukeboxUrl = el.value.trim() || "https://www.youtube.com/watch?v=CLLpSmaof4E";
        saveLocalSettings();
    }
}

// ==========================================================================
// 4. UI TOGGLES, SETTINGS & MODALS
// ==========================================================================

// --- THE GLOBAL CLICK BOUNCER ---
// Actively listens for clicks anywhere on the screen to close open menus
document.addEventListener('click', (e) => {
    
    // 1. Audio Dropdown (Closes if you click outside the caret or dropdown)
    if (!e.target.closest('.split-button-caret') && !e.target.closest('.dropdown-content')) {
        document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show'));
    }

    // 2. Widget Floating Menu (Closes if you click outside the menu panel and the float button)
    const widgetMenu = document.getElementById('widget-panel-menu');
    const widgetBtn = document.getElementById('widget-menu-btn');
    if (widgetMenu && widgetMenu.style.display === 'flex') {
        if (!widgetMenu.contains(e.target) && (!widgetBtn || !widgetBtn.contains(e.target))) {
            widgetMenu.style.display = 'none';
        }
    }

    // 3. Waffle Settings Modal (Closes if you click the background overlay)
    const waffleModal = document.getElementById('waffle-modal');
    const waffleBtn = document.getElementById('waffleViewBtn');
    if (waffleModal && waffleModal.classList.contains('show')) {
        // If they click exactly on the dark semi-transparent background...
        if (e.target === waffleModal) {
            toggleWaffleMenu(false);
        } 
        // Or if they click somewhere else entirely outside the white box
        else {
            const modalContent = waffleModal.querySelector('.waffle-modal-content');
            if (modalContent && !modalContent.contains(e.target) && (!waffleBtn || !waffleBtn.contains(e.target))) {
                toggleWaffleMenu(false);
            }
        }
    }
});

document.addEventListener('fullscreenchange', () => {
    const fsBtn = document.getElementById('fullScreenBtn');
    if(fsBtn) fsBtn.classList.toggle('active-btn', document.fullscreenElement);
});

function updateFloatingPlayerVisibility() {
    const player = document.getElementById('floating-player');
    if (player) {
        if (activePlayerUrl) player.classList.add('visible');
        else player.classList.remove('visible');
    }
}

// Floating Player Drag Logic
document.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('mousedown', function(e) {
        if (window.innerWidth <= 850) return; 
        let isDragging = true;
        const player = handle.closest('.floating-player');
        player.classList.add('dragging');
        let startX = e.clientX; let startY = e.clientY;
        
        document.onmouseup = function() {
            isDragging = false; document.onmouseup = null; document.onmousemove = null; player.classList.remove('dragging');
        };
        document.onmousemove = function(ev) {
            if (!isDragging) return;
            ev.preventDefault();
            let diffX = startX - ev.clientX; let diffY = startY - ev.clientY;
            startX = ev.clientX; startY = ev.clientY;
            player.style.top = (player.offsetTop - diffY) + "px"; player.style.left = (player.offsetLeft - diffX) + "px";
            player.style.bottom = 'auto'; player.style.right = 'auto';
        };
    });
});

function reloadWeatherWidget() {
    const container1 = document.getElementById('weather-container-main');
    if(!container1) return;
    const color = isDarkMode ? '#ffffff' : '#333333';
    container1.innerHTML = `<a class="weatherwidget-io" href="https://forecast7.com/en/33d98n84d43/east-cobb/?unit=us" data-label_1="EAST COBB" data-theme="pure" data-basecolor="rgba(0,0,0,0)" data-textcolor="${color}">EAST COBB</a>`;
    !function(d,s,id){var js,fjs=d.getElementsByTagName(s)[0];if(!d.getElementById(id)){js=d.createElement(s);js.id=id;}else{js=d.getElementById(id);js.remove();js=d.createElement(s);js.id=id;}js.src='https://weatherwidget.io/js/widget.min.js';fjs.parentNode.insertBefore(js,fjs);}(document,'script','weatherwidget-io-js');
}

function toggleWidgetPanel(e) {
    if(e) e.stopPropagation();
    const p = document.getElementById('widget-panel-menu');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function toggleWidget(id, isChecked) {
    activeWidgets[id] = isChecked;
    const card = document.getElementById(`widget-${id}`);
    if(card) {
        if(isChecked) card.classList.add('active-widget');
        else card.classList.remove('active-widget');
    }
    if (id === 'weather' && isChecked) reloadWeatherWidget();
    
    const floatTog = document.getElementById(`wm-tog-${id}`);
    if(floatTog) floatTog.checked = isChecked;
    
    applyLayout(); 
    saveLocalSettings();
}

function toggleSidebar(e) {
    if(e) e.stopPropagation();
    sidebarVisible = !sidebarVisible;
    const sidebar = document.getElementById('sidebar');
    const hamBtn = document.getElementById('hamburgerBtn');
    if(sidebar) {
        if (sidebarVisible) {
            sidebar.classList.remove('collapsed');
            if(hamBtn) hamBtn.classList.add('active-btn');
        } else {
            sidebar.classList.add('collapsed');
            if(hamBtn) hamBtn.classList.remove('active-btn');
        }
    }
    saveLocalSettings();
}

function toggleWaffleMenu(force) {
    const modal = document.getElementById('waffle-modal');
    const btn = document.getElementById('waffleViewBtn');

    if (force === false) {
        isWaffleClosed = true;
    } else if (force === true) {
        isWaffleClosed = false;
    } else {
        isWaffleClosed = !isWaffleClosed;
    }

    if (modal && btn) {
        if (isWaffleClosed) {
            modal.classList.remove('show');
            btn.classList.remove('active-btn');
        } else {
            renderWaffleSettings(); 
            modal.classList.add('show');
            btn.classList.add('active-btn');
        }
    }
    saveLocalSettings();
}

function renderWaffleSettings() {
    const list = document.getElementById('waffle-settings-list');
    if(!list) return;
    list.innerHTML = '';
    
    const periods = ['1', 'HR', '2', '3', '4', '5', '6', '7', 'A Block', 'B Block', 'C Block', 'D Block'];

    periods.forEach(key => {
        const safeKey = key.replace(/'/g, "\\'");
        const s = classSettings[key] || { ...DEFAULT_PREFS };
        
        let isWebBlock = /^[A-D](\s|-)?Block/i.test(key);
        let webOpenCheckbox = isWebBlock ?
            `<div class="options-col opt-center"><label class="switch" title="Mark as WEB Open Block"><input type="checkbox" onchange="toggleSetting('${safeKey}', 'open', this.checked)" ${s.open ? 'checked' : ''}><span class="slider"></span></label></div>` :
            `<div class="options-col"></div>`;

        const li = document.createElement('li');
        li.className = 'waffle-grid';
        li.innerHTML = `
            <div class="period-name" style="font-size: 1.1rem; font-weight: bold;">${key}</div>
            <div class="options-wrapper">
                <div class="options-col"><label class="switch" title="Phone Caddy"><input type="checkbox" onchange="toggleSetting('${safeKey}', 'putaway', this.checked)" ${s.putaway ? 'checked' : ''}><span class="slider"></span></label></div>
                <div class="options-col"><label class="switch" title="Take Attendance"><input type="checkbox" onchange="toggleSetting('${safeKey}', 'attendance', this.checked)" ${s.attendance ? 'checked' : ''}><span class="slider"></span></label></div>
                <div class="options-col"><label class="switch" title="5-Min Clean Up"><input type="checkbox" onchange="toggleSetting('${safeKey}', 'cleanup', this.checked)" ${s.cleanup ? 'checked' : ''}><span class="slider"></span></label></div>
                <div class="options-col"><label class="switch" title="1 Min Warning & Retrieve"><input type="checkbox" onchange="toggleSetting('${safeKey}', 'retrieve', this.checked)" ${s.retrieve ? 'checked' : ''}><span class="slider"></span></label></div>
                ${webOpenCheckbox}
                <div class="options-col">
                    <button onclick="setIcalFeed('${safeKey}')" style="background:none;border:none;cursor:pointer;font-size:1.3rem;transition:transform 0.2s; filter: ${s.icalUrl ? 'none' : 'grayscale(100%) opacity(0.4)'}" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="${s.icalUrl ? 'Edit iCal Feed' : 'Add iCal Feed'}">📅</button>
                </div>
            </div>
        `;
        list.appendChild(li);
    });
}

function toggleSetting(key, prop, isChecked) {
    if (!classSettings[key]) classSettings[key] = { ...DEFAULT_PREFS };
    classSettings[key][prop] = isChecked;
    saveLocalSettings();
    renderSchedule(); 
}

function setIcalFeed(key) {
    if (!classSettings[key]) classSettings[key] = { ...DEFAULT_PREFS };
    const currentUrl = classSettings[key].icalUrl || '';
    const newUrl = prompt(`Enter Secret iCal URL for ${key} (Leave blank to remove):`, currentUrl);
    if (newUrl !== null) {
        classSettings[key].icalUrl = newUrl.trim();
        saveLocalSettings();
        renderWaffleSettings(); 
        renderSchedule();       
    }
}

function toggleMinimalView(force) {
    isMinimalView = force !== undefined ? force : !isMinimalView;
    const btn = document.getElementById('minimalViewBtn');
    if(btn) {
        if (isMinimalView) {
            document.body.classList.add('minimal-active'); 
            btn.classList.add('active-btn');
        } else {
            document.body.classList.remove('minimal-active'); 
            btn.classList.remove('active-btn');
        }
    }

    applyLayout();
    saveLocalSettings();
}

function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => {});
    else if (document.exitFullscreen) document.exitFullscreen();
}

function toggleDarkMode(shouldSave = true) {
    const toggle = document.getElementById('darkModeToggle');
    if(!toggle) return;
    isDarkMode = toggle.checked;
    
    if (isDarkMode) { document.body.classList.add('dark-mode'); } 
    else { document.body.classList.remove('dark-mode'); }
    
    if(activeWidgets.weather) reloadWeatherWidget();
    if (shouldSave) saveLocalSettings();
}

function toggleAccordion(id) {
    const content = document.getElementById(id);
    const chevron = document.getElementById('chev-' + id);
    if (!content || !chevron) return;
    
    if (content.style.maxHeight === "0px" || content.style.maxHeight === "") {
        content.style.maxHeight = content.scrollHeight + "px";
        chevron.style.transform = "rotate(0deg)";
        accordionStates[id] = true;
        setTimeout(() => { if(accordionStates[id]) content.style.maxHeight = "none"; }, 300);
    } else {
        content.style.maxHeight = content.scrollHeight + "px"; 
        setTimeout(() => {
            content.style.maxHeight = "0px";
            chevron.style.transform = "rotate(-90deg)";
            accordionStates[id] = false;
        }, 10);
    }
    saveLocalSettings();
}

// ==========================================================================
// 5. YOUTUBE API LOGIC 
// ==========================================================================
let ytPlayer = null;
let isYtApiReady = false;

var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() { isYtApiReady = true; }

function extractVideoID(url) {
    if(!url) return { type: null, id: null };
    const listMatch = url.match(/[?&]list=([^#\&\?]+)/);
    if (listMatch) { return { type: 'playlist', id: listMatch[1] }; }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|live\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) { return { type: 'video', id: match[2] }; }
    return { type: null, id: null };
}

function renderVibeDropdown() {
    const select = document.getElementById('vibeSelect');
    if(!select) return;
    select.innerHTML = '';
    
    if(savedVibes.length === 0) {
        select.innerHTML = '<option value="">-- Playlist Empty --</option>';
    } else {
        savedVibes.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.url;
            opt.textContent = v.title || "Saved Vibe";
            if (v.url === currentVibeUrl) opt.selected = true;
            select.appendChild(opt);
        });
    }
}

function addNewVibe() {
    const url = prompt("Paste a YouTube URL (Video or Playlist):");
    if(url) {
        const mediaData = extractVideoID(url);
        if(mediaData.id) {
            let exists = savedVibes.find(v => extractVideoID(v.url).id === mediaData.id);
            if(!exists) {
                savedVibes.push({ url: url, title: mediaData.type === 'playlist' ? 'Loading Playlist...' : 'Loading Video...' });
            }
            currentVibeUrl = url;
            saveLocalSettings();
            renderVibeDropdown();
            startVibe(); 
        } else {
            alert("Invalid YouTube URL. Please make sure it is a standard link.");
        }
    }
}

function removeVibe() {
    if(!currentVibeUrl || savedVibes.length === 0) return;
    savedVibes = savedVibes.filter(v => v.url !== currentVibeUrl);
    if(savedVibes.length > 0) {
        currentVibeUrl = savedVibes[0].url;
        saveLocalSettings();
        renderVibeDropdown();
        startVibe();
    } else {
        currentVibeUrl = '';
        saveLocalSettings();
        renderVibeDropdown();
        stopVibe();
    }
}

function changeVibeSelection() {
    const select = document.getElementById('vibeSelect');
    if(select && select.value) {
        currentVibeUrl = select.value;
        saveLocalSettings();
        lastPeriodStatus = null; 
    }
}

function applyMusicState(url, shouldPlay) {
    if (!url) { stopVibeCore(); return true; } 
    
    activePlayerUrl = url;
    updateFloatingPlayerVisibility(); 
    
    const mediaData = extractVideoID(url);
    if (!mediaData.id) return true;

    if (!isYtApiReady) return false; 

    const bgContainer = document.getElementById('vibe-bg');
    if(bgContainer) bgContainer.style.opacity = "0.45";

    if (ytPlayer) {
        try { ytPlayer.destroy(); ytPlayer = null; } catch(e) {}
    } 
    
    if(bgContainer) bgContainer.innerHTML = '<div id="yt-player-container"></div>';
    
    let playerParams = { 'autoplay': shouldPlay ? 1 : 0, 'controls': 0, 'autohide': 1, 'wmode': 'opaque', 'showinfo': 0, 'mute': 0 };
    if (mediaData.type === 'playlist') { playerParams.listType = 'playlist'; playerParams.list = mediaData.id; playerParams.loop = 1; } 
    else { playerParams.playlist = mediaData.id; playerParams.loop = 1; }

    try {
        ytPlayer = new YT.Player('yt-player-container', {
            videoId: mediaData.type === 'video' ? mediaData.id : undefined,
            playerVars: playerParams,
            events: { 
                'onReady': function(e) { 
                    try { 
                        e.target.setVolume(vibeVolume); 
                        if(shouldPlay) {
                            e.target.playVideo(); 
                            const floatBtn = document.getElementById('float-play-btn');
                            if(floatBtn) floatBtn.innerHTML = pauseSVG;
                        }
                    } catch(err) {} 
                }, 
                'onStateChange': onPlayerStateChange 
            }
        });
    } catch(e) {}
    
    return true;
}

function toggleVibePlay() {
    const floatBtn = document.getElementById('float-play-btn');
    if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
        try {
            let state = ytPlayer.getPlayerState();
            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
                ytPlayer.pauseVideo();
                if(floatBtn) floatBtn.innerHTML = playSVG;
                isMainVibePlaying = false;
                saveLocalSettings();
            } else {
                ytPlayer.playVideo();
                if(floatBtn) floatBtn.innerHTML = pauseSVG;
                isMainVibePlaying = true;
                saveLocalSettings();
            }
        } catch(e) { console.error(e); }
    } else { startVibe(); }
}

function startVibe() {
    if(!currentVibeUrl) return;
    isMainVibePlaying = true;
    const floatBtn = document.getElementById('float-play-btn');
    if(floatBtn) floatBtn.innerHTML = pauseSVG;
    saveLocalSettings();
    lastPeriodStatus = null; 
    applyMusicState(currentVibeUrl, true);
}

function stopVibeCore() {
    activePlayerUrl = '';
    const bg = document.getElementById('vibe-bg');
    if(bg) bg.style.opacity = "0";
    if (ytPlayer) { try { ytPlayer.destroy(); ytPlayer = null; } catch(e) {} }
    const floatBtn = document.getElementById('float-play-btn');
    if(floatBtn) floatBtn.innerHTML = playSVG;
    updateFloatingPlayerVisibility();
}

function stopVibe() {
    isMainVibePlaying = false;
    saveLocalSettings();
    if (activePlayerUrl === jukeboxUrl) {
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
        const floatBtn = document.getElementById('float-play-btn');
        if(floatBtn) floatBtn.innerHTML = playSVG;
    } else {
        stopVibeCore();
    }
}

function onPlayerStateChange(event) {
    const floatBtn = document.getElementById('float-play-btn');
    if(!floatBtn) return;
    
    if (event.data == YT.PlayerState.PLAYING || event.data == YT.PlayerState.BUFFERING) {
        floatBtn.innerHTML = pauseSVG;
        try {
            let title = ytPlayer.getVideoData().title;
            const titleEl = document.getElementById('float-vibe-title');
            if(title && titleEl) titleEl.innerText = title;
            
            if(title && activePlayerUrl === currentVibeUrl) {
                let updated = false;
                savedVibes.forEach(v => {
                    if(v.url === currentVibeUrl && v.title !== title) { v.title = title; updated = true; }
                });
                if(updated) { saveLocalSettings(); renderVibeDropdown(); }
            }
        } catch(e) {}
    } else if (event.data == YT.PlayerState.ENDED) {
        event.target.playVideo();
    } else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.UNSTARTED) {
        floatBtn.innerHTML = playSVG;
    }
}

function syncVibeVolume(val) {
    vibeVolume = parseInt(val);
    const mainVol = document.getElementById('vibeVolumeControl');
    const floatVol = document.getElementById('floatVibeVolume');
    const floatIcon = document.getElementById('vibeMuteIcon');
    const sideIcon = document.getElementById('sidebarVibeIcon');
    
    if(mainVol) mainVol.value = vibeVolume;
    if(floatVol) floatVol.value = vibeVolume;
    
    isVibeMuted = (vibeVolume === 0);
    if(floatIcon) floatIcon.innerText = isVibeMuted ? '🔇' : '🎵';
    if(sideIcon) sideIcon.innerText = isVibeMuted ? '🔇' : '🎵';

    if (ytPlayer && typeof ytPlayer.setVolume === 'function') { try { ytPlayer.setVolume(vibeVolume); } catch(e) {} }
    saveLocalSettings();
}

function toggleFloatVibeMute() {
    if(isVibeMuted) {
        syncVibeVolume(savedVibeVol);
    } else {
        savedVibeVol = vibeVolume > 0 ? vibeVolume : 50;
        syncVibeVolume(0);
    }
}

function syncGlobalVolume(val) {
    globalVolume = parseFloat(val);
    const mainVol = document.getElementById('volumeControl');
    const floatVol = document.getElementById('floatBellVolume');
    const floatIcon = document.getElementById('bellMuteIcon');
    const sideIcon = document.getElementById('sidebarBellIcon');
    
    if(mainVol) mainVol.value = globalVolume;
    if(floatVol) floatVol.value = globalVolume;
    
    isGlobalMuted = (globalVolume === 0);
    if(floatIcon) floatIcon.innerText = isGlobalMuted ? '🔕' : '🔔';
    if(sideIcon) sideIcon.innerText = isGlobalMuted ? '🔕' : '🔔';

    const audio = document.getElementById('regularBellAudio'); 
    if(audio) audio.volume = globalVolume;

    saveLocalSettings();
}

function toggleFloatBellMute() {
    if(isGlobalMuted) {
        syncGlobalVolume(savedGlobalVol);
    } else {
        savedGlobalVol = globalVolume > 0 ? globalVolume : 1.0;
        syncGlobalVolume(0);
    }
}

function changeVolume() { 
    const vc = document.getElementById('volumeControl');
    if(vc) syncGlobalVolume(vc.value); 
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if(!toast) return;
    toast.innerText = message; toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

// ==========================================================================
// 6. TIMERS & DATA FETCHING (QotD + Schedule)
// ==========================================================================
function updateTimerDisplay() {
    const d = document.getElementById('timer-display');
    if(!d) return;
    const m = Math.floor(timerTotalSeconds / 60).toString().padStart(2, '0');
    const s = (timerTotalSeconds % 60).toString().padStart(2, '0');
    d.innerText = `${m}:${s}`;
    if(timerTotalSeconds === 0) d.style.color = '#d9534f';
    else d.style.color = '';
}
function addTimerMinutes(mins) {
    timerTotalSeconds += (mins * 60);
    updateTimerDisplay();
}
function resetTimer() {
    timerTotalSeconds = 300; 
    updateTimerDisplay();
    if(timerIsPlaying) togglePlayTimer();
}
function togglePlayTimer() {
    const btn = document.getElementById('timer-start-btn');
    if(timerIsPlaying) {
        clearInterval(timerInterval);
        timerIsPlaying = false;
        if(btn) { btn.innerText = "Start"; btn.style.backgroundColor = '#31b0d5'; }
    } else {
        if(timerTotalSeconds <= 0) return; 
        timerIsPlaying = true;
        if(btn) { btn.innerText = "Pause"; btn.style.backgroundColor = '#d9534f'; }
        timerInterval = setInterval(() => {
            if(timerTotalSeconds > 0) {
                timerTotalSeconds--;
                updateTimerDisplay();
            } else {
                togglePlayTimer();
                playBellWithQueue(2); 
            }
        }, 1000);
    }
}

let qotdQrVisible = true;

function toggleQotdQR() {
    qotdQrVisible = !qotdQrVisible;
    document.getElementById('qotd-qr-section').style.display = qotdQrVisible ? 'flex' : 'none';
    document.getElementById('qotd-toggle-btn').innerText = qotdQrVisible ? '👁️ Hide QR Code' : '👁️ Show QR Code';
}

function fetchQotdData() {
    fetch(QOTD_APPS_SCRIPT_URL + "?action=getToday")
        .then(r => r.json())
        .then(data => {
            document.getElementById('qotd-question').innerText = data.q || "No question today";
            document.getElementById('qotd-label-a').innerText = data.a || "Option A";
            document.getElementById('qotd-label-b').innerText = data.b || "Option B";
            
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(QOTD_APPS_SCRIPT_URL)}`;
            document.getElementById('qotd-qr-img').src = qrUrl;

            const votesA = parseInt(data.votesA) || 0;
            const votesB = parseInt(data.votesB) || 0;
            const total = votesA + votesB;
            const pctA = total === 0 ? 0 : Math.round((votesA / total) * 100);
            const pctB = total === 0 ? 0 : 100 - pctA;
            
            document.getElementById('qotd-bar-a').style.width = pctA + '%';
            document.getElementById('qotd-pct-a').innerText = pctA + '%';
            document.getElementById('qotd-bar-b').style.width = pctB + '%';
            document.getElementById('qotd-pct-b').innerText = pctB + '%';
            document.getElementById('qotd-total-votes').innerText = "Total Votes: " + total;
        })
        .catch(e => console.error("Error loading QotD:", e));
}

setInterval(() => {
    if (activeWidgets.qotd) {
        try { fetchQotdData(); } catch(e){}
    }
}, 15000);

async function fetchDailySchedule() {
    const ind = document.getElementById('autoIndicator');
    if(ind) { ind.style.display = 'block'; ind.innerText = "Syncing..."; ind.style.color = '#888'; }
    
    try {
        const response = await fetch(GOOGLE_CALENDAR_SCRIPT_URL);
        const data = await response.json();
        
        if (data && data.schedule) {
            let cleanSchedule = [];
            data.schedule.forEach(p => {
                if(!p || !p.name) return;
                let cleanP = { name: String(p.name).trim(), start: String(p.start || '').trim(), end: String(p.end || '').trim() };
                if(cleanP.start.includes(':')) cleanP.start = cleanP.start.split(':').map(v => v.padStart(2, '0')).join(':');
                if(cleanP.end.includes(':')) cleanP.end = cleanP.end.split(':').map(v => v.padStart(2, '0')).join(':');
                cleanSchedule.push(cleanP);
            });

            activeSchedule = cleanSchedule;
            currentScheduleName = String(data.mode || 'Daily').toUpperCase();

            if(ind) { ind.innerText = `✓ Synced: ${currentScheduleName}`; ind.style.color = '#5cb85c'; }
            document.getElementById('schedule-title').innerText = currentScheduleName + ' Schedule ';
            renderSchedule();
            showToast(`Loaded: ${currentScheduleName} Schedule`);
        }
    } catch (err) {
        console.error("Schedule sync failed:", err);
        if(ind) { ind.innerText = "⚠ Offline"; ind.style.color = '#d9534f'; }
        showToast("Could not fetch schedule from Google.");
    }
}

async function fetchAgenda(url, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    let fetchUrlStr = url.trim();
    if (fetchUrlStr.startsWith('webcal://')) {
        fetchUrlStr = 'https://' + fetchUrlStr.substring(9);
    }

    if (agendaCache[fetchUrlStr]) {
        if (agendaCache[fetchUrlStr] !== 'empty') {
            el.innerHTML = agendaCache[fetchUrlStr];
            el.classList.add('has-data');
        } else {
            el.innerHTML = "";
            el.classList.remove('has-data');
        }
        return;
    }

    el.innerHTML = "<em>Fetching...</em>";
    el.classList.add('has-data');

    try {
        if (!agendaPromises[fetchUrlStr]) {
            const fetchUrl = `${GOOGLE_CALENDAR_SCRIPT_URL.split('?')[0]}?icalUrl=${encodeURIComponent(fetchUrlStr)}`;
            
            agendaPromises[fetchUrlStr] = fetch(fetchUrl).then(async (response) => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const icsData = await response.text();

                if (icsData.startsWith('Error:')) {
                    return `<em class="agenda-error" title="${icsData}">Apps Script error</em>`;
                }

                if (!icsData || (!icsData.includes('BEGIN:VCALENDAR') && !icsData.includes('BEGIN:VEVENT'))) {
                    return "<em class='agenda-error' title='Ensure you used the Secret iCal Address'>Invalid calendar data</em>";
                }

                const today = new Date();
                const todayInt = parseInt(today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0'), 10);
                
                const events = icsData.split('BEGIN:VEVENT');
                let todaysEvents = [];

                for (let i = 1; i < events.length; i++) {
                    const eventText = events[i];
                    
                    const dtStartMatch = eventText.match(/DTSTART(?:;[^:]*)?:([0-9]{8})/); 
                    const dtEndMatch = eventText.match(/DTEND(?:;[^:]*)?:([0-9]{8})/); 
                    const isTimedMatch = eventText.match(/DTSTART(?:;[^:]*)?:[0-9]{8}T/);
                    const summaryMatch = eventText.match(/SUMMARY:([^\r\n]*)/);

                    if (dtStartMatch && summaryMatch) {
                        const startInt = parseInt(dtStartMatch[1], 10);
                        let isActive = false;

                        if (dtEndMatch) {
                            const endInt = parseInt(dtEndMatch[1], 10);
                            if (isTimedMatch) {
                                isActive = (todayInt >= startInt && todayInt <= endInt);
                            } else {
                                isActive = (todayInt >= startInt && todayInt < endInt);
                            }
                        } else {
                            isActive = (startInt === todayInt);
                        }

                        if (isActive) {
                            todaysEvents.push(summaryMatch[1].trim());
                        }
                    }
                }

                if (todaysEvents.length > 0) {
                    return todaysEvents.join(' &nbsp;|&nbsp; ');
                } else {
                    return "empty";
                }
            });
        }

        const resultHtml = await agendaPromises[fetchUrlStr];
        agendaCache[fetchUrlStr] = resultHtml;

        if (resultHtml !== 'empty') {
            el.innerHTML = resultHtml;
            el.classList.add('has-data');
        } else {
            el.innerHTML = "";
            el.classList.remove('has-data');
        }

    } catch (error) {
        el.innerHTML = "<em class='agenda-error'>Error loading feed.</em>";
        agendaCache[fetchUrlStr] = "<em class='agenda-error'>Error loading feed.</em>";
    }
}

function renderSchedule() {
    const list = document.getElementById('schedule-list'); 
    if(!list) return;
    list.innerHTML = '';
    
    if (!Array.isArray(activeSchedule)) {
        list.innerHTML = '<li style="text-align:center; padding: 20px;"><em>Schedule data is missing or corrupted.</em></li>'; return; 
    }

    if (activeSchedule.length === 0) { 
        list.innerHTML = '<li style="text-align:center; padding: 20px;"><em>Waiting for Google...</em></li>'; return; 
    }

    activeSchedule.forEach(period => {
        try {
            const key = String(period.name);
            const safeKey = key.replace(/'/g, "\\'"); 
            const s = classSettings[key] || { ...DEFAULT_PREFS };
            
            const li = document.createElement('li'); 
            li.className = 'schedule-grid';
            li.dataset.start = String(period.start);
            li.dataset.end = String(period.end);
            
            let openBadgeHtml = s.open ? `<span class="open-badge">OPEN</span>` : ``;

            li.innerHTML = `
                <div class="period-name">${key} ${openBadgeHtml}</div>
                <div class="middle-section">
                    <div class="agenda-display" id="agenda-${safeKey}"></div>
                </div>
                <div class="period-time">${formatTime12(String(period.start))} - ${formatTime12(String(period.end))}</div>
            `;
            list.appendChild(li);
            
            if (s.icalUrl) {
                fetchAgenda(s.icalUrl, `agenda-${safeKey}`);
            }
        } catch(e) { console.error("Error rendering a row:", e); }
    });
    
    highlightCurrentPeriod(new Date());
}

// ==========================================================================
// 7. LOCAL STORAGE & INITIALIZATION
// ==========================================================================
function saveLocalSettings() {
    if (isBooting) return;
    const grid = document.getElementById('master-grid');
    if(grid) {
        const widgets = Array.from(grid.querySelectorAll('.widget-card'));
        const currentLayout = widgets.map(el => {
            return { id: el.id, height: el.style.height }; 
        });
        if (isMinimalView) layoutFocus = currentLayout;
        else layoutNormal = currentLayout;
    }

    try {
        const data = {
            vol: globalVolume, voice: globalVoicePref, testSound: currentTestSound,
            side: sidebarVisible, waffleClosed: isWaffleClosed, minimalView: isMinimalView, dark: isDarkMode, zero: showZero, playGoodbyes: playGoodbyes,
            settings: classSettings, lunchDuties: lunchDuties,
            savedVibes: savedVibes, vibe: currentVibeUrl, vibeVol: vibeVolume, muteB: muteBells,
            mrBsJukebox: mrBsJukebox, jukeboxUrl: jukeboxUrl, isMainVibePlaying: isMainVibePlaying,
            customReminders: customReminders, accordions: accordionStates, widgets: activeWidgets,
            layoutNormal: layoutNormal, layoutFocus: layoutFocus
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data)); 
    } catch (e) {}
}

function loadLocalSettings() {
    try {
        const saved = localStorage.getItem(SAVE_KEY); 
        if (!saved) return;
        
        const p = JSON.parse(saved);
        
        try { if (p.layoutNormal) layoutNormal = p.layoutNormal; } catch(e){}
        try { if (p.layoutFocus) layoutFocus = p.layoutFocus; } catch(e){}

        try { if (p.settings) classSettings = p.settings; } catch(e){}
        try { if (p.lunchDuties) { lunchDuties = p.lunchDuties; renderLunchDuties(); } } catch(e){}
        try { if (p.customReminders) { customReminders = p.customReminders; renderCustomReminders(); } } catch(e){}
        
        try { if (p.vol !== undefined) { syncGlobalVolume(p.vol); } else { syncGlobalVolume(1.0); } } catch(e){}
        try { if (p.vibeVol !== undefined) { syncVibeVolume(p.vibeVol); } } catch(e){}

        try { 
            if (p.testSound) {
                currentTestSound = p.testSound;
                const labels = {
                    'positive': 'Voice Test', 'start': 'Class Start', 'end': 'Class End', 'warning1m': '1-Min Warning',
                    'attendance': 'Take Attend.', 'cleanup': '5-Min Clean', 'lunch': 'Lunch Duty'
                };
                const pBtn = document.getElementById("playBtn");
                if (labels[currentTestSound] && pBtn) pBtn.innerHTML = "▶ Play " + labels[currentTestSound];
            }
        } catch(e){}
        
        try { 
            if (p.minimalView !== undefined) { 
                isMinimalView = p.minimalView;
                const btn = document.getElementById('minimalViewBtn');
                if (isMinimalView) {
                    document.body.classList.add('minimal-active'); 
                    if(btn) btn.classList.add('active-btn');
                }
            } 
        } catch(e){}
        
        try { 
            if (p.dark === true) { 
                isDarkMode = true;
                const dmToggle = document.getElementById('darkModeToggle');
                if(dmToggle) dmToggle.checked = true; 
                document.body.classList.add('dark-mode');
            }
        } catch(e){}

        try { 
            if (p.zero === true) { 
                showZero = true; 
                const zeroToggle = document.getElementById('showZeroPeriod');
                if(zeroToggle) zeroToggle.checked = true; 
            }
        } catch(e){}

        try { 
            if (p.playGoodbyes === true) { 
                playGoodbyes = true; 
                const pgToggle = document.getElementById('playGoodbyes');
                if(pgToggle) pgToggle.checked = true; 
            }
        } catch(e){}

        try { 
            if (p.muteB === true) { 
                muteBells = true; 
                const mbToggle = document.getElementById('muteBellsToggle');
                if(mbToggle) mbToggle.checked = true; 
            }
        } catch(e){}
        
        try { 
            if (p.savedVibes) savedVibes = p.savedVibes;
            if (p.vibe && savedVibes.length === 0) {
                savedVibes.push({ url: p.vibe, title: 'Saved Vibe' });
                currentVibeUrl = p.vibe;
            } else if (p.vibe) {
                currentVibeUrl = p.vibe;
            }
            renderVibeDropdown();
        } catch(e){}

        try { 
            if (p.mrBsJukebox !== undefined) mrBsJukebox = p.mrBsJukebox;
            if (p.jukeboxUrl) jukeboxUrl = p.jukeboxUrl;
            if (p.isMainVibePlaying !== undefined) isMainVibePlaying = p.isMainVibePlaying;

            const jkToggle = document.getElementById('jukeboxToggle');
            if(jkToggle) jkToggle.checked = mrBsJukebox;
            const jkInput = document.getElementById('jukeboxUrlInput');
            if(jkInput && jukeboxUrl !== "https://www.youtube.com/watch?v=CLLpSmaof4E") {
                jkInput.value = jukeboxUrl;
            }
        } catch(e){}

        try { 
            if (p.widgets) {
                activeWidgets = p.widgets;
                Object.keys(p.widgets).forEach(key => {
                    const tog = document.getElementById(`wm-tog-${key}`);
                    if(tog) {
                        tog.checked = p.widgets[key];
                        const card = document.getElementById(`widget-${key}`);
                        if(card) {
                            if(p.widgets[key]) card.classList.add('active-widget');
                            else card.classList.remove('active-widget');
                        }
                    }
                });
            }
        } catch(e){}

        try { 
            if (p.accordions) {
                accordionStates = p.accordions;
                Object.keys(accordionStates).forEach(id => {
                    if(accordionStates[id] === false) {
                        const el = document.getElementById(id);
                        if(el) el.style.maxHeight = "0px";
                        const chev = document.getElementById('chev-'+id);
                        if(chev) chev.style.transform = "rotate(-90deg)";
                    }
                });
            }
        } catch(e){}
        
        try { if(p.voice) globalVoicePref = p.voice; } catch(e){}
    } catch (e) {
        console.error("Local Storage parse error.", e);
    }
}

// ==========================================================================
// 8. MASTER CLOCK LOOP
// ==========================================================================
function timeToMins(t) { if (!t || !t.includes(':')) return 0; let [h, m] = t.split(':').map(Number); return h * 60 + m; }
function formatTime12(time24) { if (!time24 || !time24.includes(':')) return time24 || ''; let [h, m] = time24.split(':'); let ampm = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${m} ${ampm}`; }
function subtractMinutes(time24, minsToSubtract) { if (!time24 || !time24.includes(':')) return ''; let [h, m] = time24.split(':').map(Number); let d = new Date(); d.setHours(h, m, 0, 0); d.setMinutes(d.getMinutes() - minsToSubtract); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); }
function addMinutes(time24, minsToAdd) { if (!time24 || !time24.includes(':')) return ''; let [h, m] = time24.split(':').map(Number); let d = new Date(); d.setHours(h, m, 0, 0); d.setMinutes(d.getMinutes() + minsToAdd); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); }
function getMidpoint(start, end) { if (!start || !end || !start.includes(':') || !end.includes(':')) return ''; let [sh, sm] = start.split(':').map(Number); let [eh, em] = end.split(':').map(Number); let midMins = Math.floor(((sh * 60 + sm) + (eh * 60 + em)) / 2); return Math.floor(midMins / 60).toString().padStart(2, '0') + ':' + (midMins % 60).toString().padStart(2, '0'); }

function triggerVisualAlert() {
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:-1; pointer-events:none; transition: background-color 0.5s;";
    overlay.style.backgroundColor = isDarkMode ? "rgba(51, 43, 0, 0.8)" : "rgba(255, 243, 205, 0.8)";
    document.body.appendChild(overlay);
    setTimeout(() => { overlay.style.backgroundColor = "transparent"; }, 5500); 
    setTimeout(() => { overlay.remove(); }, 6000); 
}

function highlightCurrentPeriod(now) {
    const listItems = document.querySelectorAll('#schedule-list li');
    if (listItems.length === 0) return null;
    
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const currentSecs = currentMins * 60 + now.getSeconds();
    let highlightIndex = -1; let actualClassIndex = -1; let upcomingClassIndex = -1;
    let inSchool = false; let isPassing = false; let periods = [];
    
    listItems.forEach((li, index) => {
        periods.push({ index: index, startMins: timeToMins(li.dataset.start), endMins: timeToMins(li.dataset.end), li: li });
        li.classList.remove('current-period'); li.style.setProperty('--progress', '0%');
    });

    if (periods.length === 0) return null;

    if (currentMins >= periods[0].startMins && currentMins < periods[periods.length - 1].endMins) {
        inSchool = true;
        for (let i = 0; i < periods.length; i++) {
            let p = periods[i];
            if (currentMins >= p.startMins && currentMins < p.endMins) { actualClassIndex = p.index; break; }
            if (currentMins < p.startMins) { if (i > 0 && currentMins >= periods[i-1].endMins) { upcomingClassIndex = p.index; } break; }
        }
    }

    if (actualClassIndex !== -1) { highlightIndex = actualClassIndex; isPassing = false; } 
    else if (upcomingClassIndex !== -1) { highlightIndex = upcomingClassIndex; isPassing = true; }

    if (highlightIndex !== -1) {
        let p = periods[highlightIndex];
        p.li.classList.add('current-period');
        if (!isPassing) {
            let startSecs = p.startMins * 60; let endSecs = p.endMins * 60;
            let progress = Math.max(0, Math.min(100, ((currentSecs - startSecs) / (endSecs - startSecs)) * 100));
            p.li.style.setProperty('--progress', progress + '%');
        } else { p.li.style.setProperty('--progress', '0%'); }
    }

    return { index: highlightIndex, isPassing: isPassing, periodData: highlightIndex !== -1 ? periods[highlightIndex] : null, actualClass: actualClassIndex !== -1 };
}

function triggerEvent(time, action, callback) {
    if (currentMinuteTracker !== time) { playedActions = {}; currentMinuteTracker = time; }
    const eventKey = `${time}-${action}`;
    if (!playedActions[eventKey]) { callback(); playedActions[eventKey] = true; }
}

function updateClock() {
    const clk = document.getElementById('clock');
    if(clk) {
        const now = new Date();
        clk.innerText = now.toLocaleTimeString('en-US'); 
    }
    
    try {
        const now = new Date();
        let current24 = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        const todayDayOfWeek = now.getDay(); 
        
        let status = highlightCurrentPeriod(now);
        let currentStatus = 'outside'; let autoState = 'passing'; let isDeadTime = false; let currentProgress = 0;

        if (status && status.isPassing) { currentStatus = 'passing'; autoState = 'passing'; } 
        else if (status && status.actualClass) {
            currentStatus = 'class';
            const p = status.periodData;
            const currentMins = now.getHours() * 60 + now.getMinutes();
            const currentSecs = currentMins * 60 + now.getSeconds();
            
            let startSecs = p.startMins * 60; let endSecs = p.endMins * 60;
            currentProgress = Math.max(0, Math.min(100, ((currentSecs - startSecs) / (endSecs - startSecs)) * 100));

            if (currentMins >= p.startMins && currentMins < p.startMins + 5) { autoState = 'dead-start'; isDeadTime = true; } 
            else if (currentMins >= p.endMins - 5 && currentMins < p.endMins) { autoState = 'dead-end'; isDeadTime = true; } 
            else { autoState = 'core-class'; }
        }

        let dName = document.getElementById('docked-name'); let dTime = document.getElementById('docked-time'); let dBadge = document.getElementById('docked-badge');
        
        if (status && status.actualClass) {
            const p = status.periodData;
            if (dName) dName.innerText = p.li.querySelector('.period-name').innerText;
            if (dTime) dTime.innerText = p.li.querySelector('.period-time').innerText;
            const s = classSettings[dName.innerText.trim()] || DEFAULT_PREFS;
            if (s.open && dBadge) dBadge.style.display = 'inline-block'; else if (dBadge) dBadge.style.display = 'none';
        } else if (status && status.isPassing) {
            if (dName) dName.innerText = "Passing Period";
            const p = status.periodData;
            if (dTime) dTime.innerText = "Next: " + p.li.querySelector('.period-name').innerText;
            if (dBadge) dBadge.style.display = 'none';
        } else {
            if (dName) dName.innerText = "Outside School Hours";
            if (dTime) dTime.innerText = "--:--";
            if (dBadge) dBadge.style.display = 'none';
        }

        const dProg = document.getElementById('docked-progress-fill');
        if (dProg) {
            if (status && status.actualClass) {
                dProg.style.width = currentProgress + '%';
                dProg.style.backgroundColor = isDeadTime ? '#d9534f' : '#31b0d5';
            } else { dProg.style.width = '0%'; }
        }

        const warningElMain = document.getElementById('main-dead-time-warning');
        const warningElDock = document.getElementById('docked-warning');
        if (warningElMain) warningElMain.style.display = isDeadTime ? 'inline-block' : 'none';
        if (warningElDock) warningElDock.style.display = isDeadTime ? 'inline-block' : 'none';

        if (lastAutoState !== null && autoState !== lastAutoState) {
            if (autoState === 'core-class') { toggleMinimalView(true); } 
            else if (autoState === 'dead-start' || autoState === 'dead-end' || autoState === 'passing') { toggleMinimalView(false); }
        }
        lastAutoState = autoState;

        if (lastPeriodStatus !== currentStatus) {
            let success = false;
            if (mrBsJukebox && todayDayOfWeek === 5 && currentStatus === 'passing') { success = applyMusicState(jukeboxUrl, true); } 
            else {
                if (isMainVibePlaying && currentVibeUrl) { success = applyMusicState(currentVibeUrl, true); } 
                else { success = applyMusicState('', false); }
            }
            if (success) lastPeriodStatus = currentStatus;
        }

        if (current24 === '06:00' && now.getSeconds() === 0) { fetchDailySchedule(); }
        
        customReminders.forEach(rem => {
            if (current24 === rem.time) {
                if (rem.day === 'All' || parseInt(rem.day) === todayDayOfWeek) {
                    triggerEvent(current24, `custom-${rem.name}`, () => {
                        triggerVisualAlert();
                        playBellWithQueue(1, () => speak(`Reminder. ${rem.name}`));
                    });
                }
            }
        });
        
        if(!Array.isArray(activeSchedule)) return;

        activeSchedule.forEach(period => {
            if (!period || !period.name) return;
            const pNameStr = String(period.name);
            const s = classSettings[pNameStr] || { ...DEFAULT_PREFS };
            const hasLunch1 = lunchDuties.some(d => d.day === todayDayOfWeek && String(d.period).toLowerCase() === pNameStr.toLowerCase() && d.half === 1);
            const hasLunch2 = lunchDuties.some(d => d.day === todayDayOfWeek && String(d.period).toLowerCase() === pNameStr.toLowerCase() && d.half === 2);

            const pStartStr = String(period.start); const pEndStr = String(period.end);
            const startMinus1 = subtractMinutes(pStartStr, 1); const startPlus5 = addMinutes(pStartStr, 5);
            const endMinus5 = subtractMinutes(pEndStr, 5); const endMinus1 = subtractMinutes(pEndStr, 1);
            const midPoint = getMidpoint(pStartStr, pEndStr);

            if (current24 === pStartStr) {
                triggerEvent(current24, `start-${pNameStr}`, () => {
                    triggerVisualAlert(); let speechText = "";
                    if (s.open) speechText += "Please remember to sign in to WEB. ";
                    if (s.putaway) speechText += "Class is beginning. Please place your phones in the cell phone caddy. ";
                    if (hasLunch1) speechText += "Reminder: You have lunch duty today.";
                    if (speechText) playBellWithQueue(3, () => speak(speechText)); else playBellWithQueue(3);
                });
            }
            
            if (current24 === pEndStr) {
                triggerEvent(current24, `end-${pNameStr}`, () => { 
                    triggerVisualAlert(); 
                    if (playGoodbyes) { const randomMsg = GOODBYE_MESSAGES[Math.floor(Math.random() * GOODBYE_MESSAGES.length)]; playBellWithQueue(3, () => speak(randomMsg)); } 
                    else { playBellWithQueue(3); }
                });
            }

            if (!s.open && current24 === startMinus1) {
                triggerEvent(current24, `warning1m-${pNameStr}`, () => {
                    triggerVisualAlert(); let speechText = "One minute until class begins.";
                    if (s.putaway) speechText += " Please place your phones in the cell phone caddy.";
                    playBellWithQueue(1, () => speak(speechText));
                });
            }

            if (!s.open && s.attendance && current24 === startPlus5) { triggerEvent(current24, `attendance5m-${pNameStr}`, () => { triggerVisualAlert(); speak("Reminder. Please take attendance."); }); }
            if (!s.open && hasLunch2 && current24 === midPoint) { triggerEvent(current24, `lunch2-${pNameStr}`, () => { triggerVisualAlert(); speak("Reminder. You have second half lunch duty."); }); }
            if (!s.open && s.cleanup && current24 === endMinus5) { triggerEvent(current24, `cleanup5m-${pNameStr}`, () => { triggerVisualAlert(); speak("Five minutes remaining. Please begin cleaning up your area."); }); }

            if (!s.open && s.retrieve && current24 === endMinus1) {
                triggerEvent(current24, `phone1m-${pNameStr}`, () => { 
                    triggerVisualAlert(); let speechText = "One minute remaining.";
                    if (s.putaway) speechText += " You may retrieve your cell phones.";
                    playBellWithQueue(1, () => speak(speechText)); 
                });
            }
        });
    } catch(e) { 
        console.error("Clock loop error:", e); 
    }
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initWidgets();
    
    const isV3 = localStorage.getItem('waltonSettingsV3_Migrated');
    if (!isV3) {
        localStorage.removeItem('waltonDashboardV2');
        localStorage.removeItem('waltonBellState');
        localStorage.setItem('waltonSettingsV3_Migrated', 'true');
    }

    loadLocalSettings();
    applyLayout();
    fetchQotdData();
    
    const sidebar = document.getElementById('sidebar');
    const hamBtn = document.getElementById('hamburgerBtn');
    if(sidebar) sidebar.classList.add('collapsed');
    if(hamBtn) hamBtn.classList.remove('active-btn');
    sidebarVisible = false;

    const waffleModal = document.getElementById('waffle-modal');
    if (waffleModal) waffleModal.classList.remove('show');

    updateTimerDisplay();
    updateClock();
    setInterval(updateClock, 1000);
    
    fetchDailySchedule();

    try {
        if ('speechSynthesis' in window) {
            safePopulateVoiceList();
            window.speechSynthesis.onvoiceschanged = safePopulateVoiceList;
        }
    } catch(e) {}
    
    setTimeout(() => { isBooting = false; }, 1500);
});
