// ====== Глобальные данные ======
let routesData = null;
let allStops = [];

// ====== Утилиты ======

function getCurrentDayType() {
    const d = new Date().getDay();
    if (d === 1 || d === 3 || d === 5 || d === 0) return '-1';
    return '-2';
}

function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function formatCountdown(diffMin) {
    if (diffMin < 0) return '';
    if (diffMin === 0) return 'сейчас';
    if (diffMin === 1) return 'через 1 мин';
    if (diffMin < 60) return `через ${diffMin} мин`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `через ${h} ч` : `через ${h} ч ${m} мин`;
}

function directionLabel(dir) {
    switch (dir) {
        case 'to_work':   return '→ К месту работы';
        case 'from_work': return '← С работы';
        case 'to_lunch':  return '→ На обед';
        case 'from_lunch': return '← С обеда';
        default: return dir;
    }
}

// ====== Загрузка данных ======

async function loadData() {
    const resp = await fetch('routes.json');
    routesData = await resp.json();
    buildStopIndex();
    fillStopSelects();
}

function buildStopIndex() {
    const stopsSet = new Set();
    for (const routeNum of Object.keys(routesData)) {
        for (const route of routesData[routeNum].routes) {
            for (const seg of route.segments) {
                for (const trip of seg.trips) {
                    for (const stop of trip.stops) {
                        stopsSet.add(stop.name);
                    }
                }
            }
        }
    }
    allStops = Array.from(stopsSet).sort((a, b) => a.localeCompare(b, 'ru'));
}

function fillStopSelects() {
    const fromSel = document.getElementById('from-select');
    const toSel = document.getElementById('to-select');
    fromSel.length = 1;
    toSel.length = 1;

    for (const stop of allStops) {
        const opt1 = document.createElement('option');
        opt1.value = stop;
        opt1.textContent = stop;
        fromSel.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = stop;
        opt2.textContent = stop;
        toSel.appendChild(opt2);
    }
}

// ====== Поиск рейсов ======

function findUpcomingTrips(fromStop, toStop, dayFilter) {
    const dayType = dayFilter === 'auto' ? getCurrentDayType() : dayFilter;
    const now = nowMinutes();
    const results = [];
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'upcoming';

    for (const routeNum of Object.keys(routesData)) {
        for (const route of routesData[routeNum].routes) {
            const sheetDayType = route.days.includes('monday') && route.days.includes('sunday')
                ? '-1'
                : (route.days.includes('tuesday') ? '-2' : null);

            if (sheetDayType !== dayType) continue;

            for (const seg of route.segments) {
                for (const trip of seg.trips) {
                    const idxFrom = trip.stops.findIndex(s => s.name === fromStop);
                    const idxTo = trip.stops.findIndex(s => s.name === toStop);
                    if (idxFrom < 0 || idxTo < 0) continue;
                    if (idxTo <= idxFrom) continue;

                    const stopTime = trip.stops[idxFrom].time;
                    const stopMin = timeToMinutes(stopTime);
                    let diff = stopMin - now;

                    // Ночные рейсы (до 4:00) считаем "завтрашними"
                    const isNightTrip = stopMin < 4 * 60;
                    if (isNightTrip && diff < -2) {
                        diff += 24 * 60;
                    }

                    if (mode === 'upcoming' && diff < -2) continue;

                    results.push({
                        routeNum,
                        direction: seg.direction,
                        time: stopTime,
                        diff,
                        isNight: isNightTrip,
                    });
                }
            }
        }
    }

    results.sort((a, b) => a.diff - b.diff);

    // Убираем дубликаты
    const seen = new Set();
    const unique = [];
    for (const r of results) {
        const key = `${r.routeNum}|${r.time}|${r.direction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
    }

    if (mode === 'upcoming') {
        return unique.slice(0, 8);
    }
    return unique;
}

// ====== Отрисовка ======

function renderResults(trips, fromStop, toStop) {
    const results = document.getElementById('results');
    results.innerHTML = '';

    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'upcoming';

    if (trips.length === 0) {
        const msg = mode === 'upcoming'
            ? 'На сегодня рейсов больше нет. 😔<br>Попробуйте режим «Все на день» или другой день недели.'
            : 'Рейсов по этому направлению в этот день нет. 😔<br>Попробуйте другой день недели.';
        results.innerHTML = `<p class="no-trips">${msg}</p>`;
        return;
    }

    const header = document.createElement('p');
    header.className = 'hint';
    header.style.marginBottom = '12px';
    const countLabel = mode === 'all' ? ` (${trips.length})` : '';
    header.textContent = `${fromStop} → ${toStop}${countLabel}`;
    results.appendChild(header);

    for (const t of trips) {
        const div = document.createElement('div');
        div.className = 'trip';

        const isPast = mode === 'all' && t.diff < -2;
        if (isPast) div.style.opacity = '0.45';

        let countdown = '';
        if (isPast) {
            countdown = 'уже прошёл';
        } else if (t.diff > 12 * 60) {
            countdown = 'завтра, ' + formatCountdown(t.diff - 24 * 60);
        } else {
            countdown = formatCountdown(t.diff);
        }

        div.innerHTML = `
            <div>
                <span class="trip-time">${t.time}</span>
                <span class="trip-countdown">${countdown}</span>
            </div>
            <div class="trip-dir">${directionLabel(t.direction)}</div>
            <div class="trip-route">Маршрут №${t.routeNum}</div>
        `;
        results.appendChild(div);
    }
}

// ====== Обработчики ======

function onFindClick() {
    const fromStop = document.getElementById('from-select').value;
    const toStop = document.getElementById('to-select').value;
    const dayFilter = document.getElementById('day-select').value;

    if (!fromStop || !toStop) {
        alert('Выберите обе остановки');
        return;
    }
    if (fromStop === toStop) {
        alert('Остановки должны быть разными');
        return;
    }

    // Сохраняем выбор
    localStorage.setItem('bus_from_stop', fromStop);
    localStorage.setItem('bus_to_stop', toStop);
    localStorage.setItem('bus_day_filter', dayFilter);

    const trips = findUpcomingTrips(fromStop, toStop, dayFilter);
    renderResults(trips, fromStop, toStop);
}

// Автообновление раз в минуту
setInterval(() => {
    const fromStop = document.getElementById('from-select').value;
    const toStop = document.getElementById('to-select').value;
    if (fromStop && toStop && fromStop !== toStop) {
        onFindClick();
    }
}, 60 * 1000);

// ====== Старт ======

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadData();
        document.getElementById('find-btn').addEventListener('click', onFindClick);

        // Пересчёт при смене селектов и режима
        ['from-select', 'to-select', 'day-select'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if (document.getElementById('from-select').value &&
                    document.getElementById('to-select').value) {
                    onFindClick();
                }
            });
        });
        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (document.getElementById('from-select').value &&
                    document.getElementById('to-select').value) {
                    onFindClick();
                }
            });
        });

        // Восстанавливаем последний выбор
        const savedFrom = localStorage.getItem('bus_from_stop');
        const savedTo = localStorage.getItem('bus_to_stop');
        const savedDay = localStorage.getItem('bus_day_filter');

        if (savedFrom && allStops.includes(savedFrom)) {
            document.getElementById('from-select').value = savedFrom;
        }
        if (savedTo && allStops.includes(savedTo)) {
            document.getElementById('to-select').value = savedTo;
        }
        if (savedDay) {
            document.getElementById('day-select').value = savedDay;
        }

        // Автоматически показываем результат
        if (document.getElementById('from-select').value &&
            document.getElementById('to-select').value &&
            document.getElementById('from-select').value !== document.getElementById('to-select').value) {
            onFindClick();
        }

        // Кнопка «Обновить данные»
        document.getElementById('refresh-btn').addEventListener('click', async () => {
            if (!confirm('Обновить расписание? Приложение перезагрузит свежие данные с сервера.')) return;
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                }
                location.reload(true);
            } catch (e) {
                alert('Ошибка обновления: ' + e.message);
            }
        });
    } catch (e) {
        document.getElementById('results').innerHTML =
            `<p class="no-trips">Ошибка загрузки данных: ${e.message}</p>`;
        console.error(e);
    }
});