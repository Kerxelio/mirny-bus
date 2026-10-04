// ====== Глобальные данные ======
let routesData = null;
let allStops = [];          // массив { name, routeNums: Set }
let stopToRoutes = {};      // { stopName: [ { routeNum, segment, dayType } ] }

// ====== Утилиты ======

// Определяем тип дня: '-1' (Пн/Ср/Пт/Вс) или '-2' (Вт/Чт/Сб)
function getCurrentDayType() {
    const d = new Date().getDay(); // 0=Вс, 1=Пн, ..., 6=Сб
    // '-1': Пн(1), Ср(3), Пт(5), Вс(0)
    if (d === 1 || d === 3 || d === 5 || d === 0) return '-1';
    // '-2': Вт(2), Чт(4), Сб(6)
    return '-2';
}

// Текущее время в минутах от полуночи
function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

// 'HH:MM' → минуты
function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

// Минуты → 'HH:MM'
function minutesToTime(m) {
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Человекочитаемый обратный отсчёт
function formatCountdown(diffMin) {
    if (diffMin < 0) return '';
    if (diffMin === 0) return 'сейчас';
    if (diffMin === 1) return 'через 1 мин';
    if (diffMin < 60) return `через ${diffMin} мин`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `через ${h} ч` : `через ${h} ч ${m} мин`;
}

// Направление на русском
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
    // Собираем все уникальные остановки из всех маршрутов
    const stopsSet = new Set();
    stopToRoutes = {};

    for (const routeNum of Object.keys(routesData)) {
        for (const route of routesData[routeNum].routes) {
            const dayType = route.days.includes('monday') && route.days.includes('sunday')
                ? '-1'
                : (route.days.includes('tuesday') ? '-2' : null);

            for (const seg of route.segments) {
                for (const trip of seg.trips) {
                    for (const stop of trip.stops) {
                        stopsSet.add(stop.name);
                        if (!stopToRoutes[stop.name]) stopToRoutes[stop.name] = [];
                        stopToRoutes[stop.name].push({
                            routeNum,
                            segment: seg,
                            dayType,
                            sheet: route.sheet,
                        });
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

    // Очищаем, оставляем только первый option
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

// ====== Поиск ближайших рейсов ======

function findUpcomingTrips(fromStop, toStop, dayFilter) {
    const dayType = dayFilter === 'auto' ? getCurrentDayType() : dayFilter;
    const now = nowMinutes();
    const results = [];

    for (const routeNum of Object.keys(routesData)) {
        for (const route of routesData[routeNum].routes) {
            // Определяем тип дня для этого листа
            const sheetDayType = route.days.includes('monday') && route.days.includes('sunday')
                ? '-1'
                : (route.days.includes('tuesday') ? '-2' : null);

            if (sheetDayType !== dayType) continue;

            for (const seg of route.segments) {
                for (const trip of seg.trips) {
                    const idxFrom = trip.stops.findIndex(s => s.name === fromStop);
                    const idxTo = trip.stops.findIndex(s => s.name === toStop);
                    if (idxFrom < 0 || idxTo < 0) continue;
                    // Автобус должен ехать ВПЕРЁД (от from к to)
                    if (idxTo <= idxFrom) continue;

                    const stopTime = trip.stops[idxFrom].time;
                    const stopMin = timeToMinutes(stopTime);
                    let diff = stopMin - now;

                    // Ночные рейсы (после полуночи): если разница меньше -12 часов,
                    // значит рейс "завтра" — переносим его на сутки вперёд.
                    if (diff < -720) {
                        diff += 24 * 60;
                    }

                    const mode = document.querySelector('input[name="mode"]:checked').value;

                    // В режиме "Ближайшие" пропускаем уже прошедшие рейсы
                    if (mode === 'upcoming' && diff < -2) continue;

                    results.push({
                        routeNum,
                        direction: seg.direction,
                        time: stopTime,
                        diff,
                        departure: trip.departure,
                    });
                }
            }
        }
    }

    // Сортируем по ближайшему времени
    results.sort((a, b) => a.diff - b.diff);

    // Убираем дубликаты (одинаковый маршрут + время + направление)
    const seen = new Set();
    const unique = [];
    for (const r of results) {
        const key = `${r.routeNum}|${r.time}|${r.direction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
    }

    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === 'upcoming') {
        return unique.slice(0, 8);
    }
    return unique;
}

// ====== Отрисовка ======

function renderResults(trips, fromStop, toStop) {
    const results = document.getElementById('results');
    results.innerHTML = '';

    // Определяем текущий режим
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'upcoming';

    // Если рейсов нет
    if (trips.length === 0) {
        const msg = mode === 'upcoming'
            ? 'На сегодня рейсов больше нет. 😔<br>Попробуйте режим «Все на день» или другой день недели.'
            : 'Рейсов по этому направлению в этот день нет. 😔<br>Попробуйте другой день недели.';
        results.innerHTML = `<p class="no-trips">${msg}</p>`;
        return;
    }

    // Заголовок
    const header = document.createElement('p');
    header.className = 'hint';
    header.style.marginBottom = '12px';
    const countLabel = mode === 'all' ? ` (${trips.length})` : '';
    header.textContent = `${fromStop} → ${toStop}${countLabel}`;
    results.appendChild(header);

    // Текущее время для определения "прошедших"
    const now = nowMinutes();

    // Отрисовка каждого рейса
    for (const t of trips) {
        const div = document.createElement('div');
        div.className = 'trip';

        // В режиме "Все" приглушаем прошедшие рейсы
        const isPast = mode === 'all' && t.diff < -2;
        if (isPast) {
            div.style.opacity = '0.45';
        }

        // Обратный отсчёт: показываем только для будущих рейсов
        let countdown = '';
        if (isPast) {
            countdown = 'уже прошёл';
        } else if (t.diff > 12 * 60) {
            // Больше 12 часов — вероятно, это завтрашний ночной рейс
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

// ====== Главный обработчик ======

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
        // Сохраняем выбор пользователя
    localStorage.setItem('bus_from_stop', fromStop);
    localStorage.setItem('bus_to_stop', toStop);

    const trips = findUpcomingTrips(fromStop, toStop, dayFilter);
    renderResults(trips, fromStop, toStop);
}

// ====== Автообновление раз в минуту ======

let lastFromStop = '';
let lastToStop = '';
let lastDayFilter = 'auto';

function autoRefresh() {
    const fromStop = document.getElementById('from-select').value;
    const toStop = document.getElementById('to-select').value;
    const dayFilter = document.getElementById('day-select').value;

    if (fromStop && toStop && fromStop !== toStop) {
        lastFromStop = fromStop;
        lastToStop = toStop;
        lastDayFilter = dayFilter;
        const trips = findUpcomingTrips(fromStop, toStop, dayFilter);
        renderResults(trips, fromStop, toStop);
    }
}

setInterval(autoRefresh, 60 * 1000); // раз в минуту

// ====== Старт ======

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadData();
        document.getElementById('find-btn').addEventListener('click', onFindClick);

        // Если день недели определился — подставляем автоматически
        // (оставляем 'auto', он и так работает)

        // Обработчик изменения select — сразу пересчитываем
        ['from-select', 'to-select', 'day-select'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if (document.getElementById('from-select').value &&
                    document.getElementById('to-select').value) {
                    onFindClick();
                }
            });
                // Восстанавливаем последние выбранные остановки из localStorage
        const savedFrom = localStorage.getItem('bus_from_stop');
        const savedTo = localStorage.getItem('bus_to_stop');
        if (savedFrom && allStops.includes(savedFrom)) {
            document.getElementById('from-select').value = savedFrom;
        }
        if (savedTo && allStops.includes(savedTo)) {
            document.getElementById('to-select').value = savedTo;
        }

        // Автоматически показываем результат, если оба сохранены
        if (document.getElementById('from-select').value &&
            document.getElementById('to-select').value &&
            document.getElementById('from-select').value !== document.getElementById('to-select').value) {
            onFindClick();
        }    
        });
        // Реагируем на смену режима
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (document.getElementById('from-select').value &&
                document.getElementById('to-select').value) {
                onFindClick();
            }
        });
    });
    } catch (e) {
        document.getElementById('results').innerHTML =
            `<p class="no-trips">Ошибка загрузки данных: ${e.message}</p>`;
        console.error(e);
    }
});