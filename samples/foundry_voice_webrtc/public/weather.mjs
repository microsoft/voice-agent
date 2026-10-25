const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current=temperature_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&timezone=America%2FLos_Angeles';

export function parseWeather(data) {
  const c = data?.current;
  for (const key of ['temperature_2m', 'is_day', 'precipitation', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m']) {
    if (!Number.isFinite(c?.[key])) throw new Error(`Weather response missing ${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.time || '')) throw new Error('Weather timestamp missing');
  if (c.precipitation < 0 || c.wind_speed_10m < 0 || c.cloud_cover < 0 || c.cloud_cover > 100 || ![0, 1].includes(c.is_day)) {
    throw new Error('Weather values out of range');
  }
  return {
    temperature: c.temperature_2m, day: c.is_day === 1, cloud: c.cloud_cover / 100,
    wet: c.precipitation, wind: c.wind_speed_10m, direction: c.wind_direction_10m,
    snow: [71, 73, 75, 77, 85, 86].includes(c.weather_code),
    fog: [45, 48].includes(c.weather_code), time: c.time,
  };
}

export function weatherLabel(w) {
  const condition = w.snow ? 'Snow' : w.wet > 0 ? 'Rain' : w.fog ? 'Fog' : w.cloud > 0.65 ? 'Cloudy' : w.cloud > 0.2 ? 'Partly cloudy' : w.day ? 'Sunny' : 'Clear';
  return `Seattle: ${condition}, ${Math.round(w.temperature)} C, wind ${Math.round(w.wind)} km/h · ${w.time.slice(11)} Seattle time`;
}

export function weatherMotion(w, time) {
  const gust = 1 + 0.18 * Math.sin(time * 0.43) + 0.08 * Math.sin(time * 1.17);
  const horizontal = -Math.sin(w.direction * Math.PI / 180) * Math.min(w.wind * 3, 120);
  // Integrate the gust so motion stays continuous instead of jumping as wind changes.
  const elapsed = time + 0.18 * (1 - Math.cos(time * 0.43)) / 0.43 +
    0.08 * (1 - Math.cos(time * 1.17)) / 1.17;
  return { horizontal, gust, drift: horizontal * elapsed };
}

export function treeSway(w, time, phase = 0) {
  const strength = Math.sqrt(Math.min(w.wind / 35, 1));
  const { horizontal, gust } = weatherMotion(w, time);
  return strength * gust * (horizontal / 120 * 0.5 +
    Math.sin(time * 0.9 + phase) * 0.35 + Math.sin(time * 1.7 + phase * 0.7) * 0.15);
}

function startWeather() {
  const canvas = document.getElementById('weather-scene');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('weather-status');
  const button = document.getElementById('weather-motion');
  if (!ctx) {
    status.textContent = 'Seattle scenery unavailable: canvas is not supported.';
    button.disabled = true;
    return;
  }
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches, weather = null, width = 0, height = 0, frame = 0, last = 0, time = 0;
  let request = null, refresh;
  // Fixed seeds keep particles and cloud layers stable across redraws and resizes.
  const particles = Array.from({ length: 160 }, (_, i) => ({
    x: ((i * 7919 + 37) % 1009) / 1009,
    y: ((i * 3571 + 83) % 1013) / 1013,
    depth: 0.35 + ((i * 127) % 100) / 100,
  }));
  const wrap = (value, size) => ((value % size) + size) % size;

  function render(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    if (!weather) return;
    const w = weather;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, w.day ? (w.cloud > 0.65 ? '#718b98' : '#8fbacc') : '#182c40');
    sky.addColorStop(0.65, w.day ? '#dce5df' : '#536773');
    sky.addColorStop(1, w.day ? '#edf0df' : '#a0afa7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * 0.77, sunY = height * 0.16;
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * 0.48);
    halo.addColorStop(0, `rgba(255,241,190,${w.day ? (1 - w.cloud) * 0.75 : 0.08})`);
    halo.addColorStop(1, 'rgba(255,241,190,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, width, height);
    if (w.cloud < 0.8) {
      ctx.fillStyle = w.day ? '#fff5d5' : '#e0e6e1';
      ctx.beginPath(); ctx.arc(sunX, sunY, w.day ? 27 : 16, 0, Math.PI * 2); ctx.fill();
    }
    const { horizontal, drift } = weatherMotion(w, time);
    for (let layer = 0; layer < 3; layer++) {
      const depth = 0.35 + layer * 0.3;
      for (let i = 0; i < 5; i++) {
        const seed = particles[layer * 5 + i];
        const x = wrap(seed.x * (width + 700) + drift * depth * 0.22, width + 700) - 350;
        const y = height * (0.06 + seed.y * 0.32);
        ctx.save(); ctx.translate(x, y); ctx.scale(1.6 + depth, 0.35 + depth * 0.25);
        for (let puff = 0; puff < 5; puff++) {
          const px = (puff - 2) * 48, py = Math.sin(puff * 2.3 + i) * 22;
          const radius = 65 + particles[i + puff].depth * 30;
          const cloud = ctx.createRadialGradient(px, py - 12, 0, px, py, radius);
          const alpha = w.cloud * (0.12 + depth * 0.12);
          cloud.addColorStop(0, `rgba(${w.day ? '248,248,239' : '133,151,168'},${alpha})`);
          cloud.addColorStop(0.55, `rgba(${w.day ? '183,198,201' : '75,94,116'},${alpha * 0.7})`);
          cloud.addColorStop(1, 'rgba(150,170,181,0)');
          ctx.fillStyle = cloud; ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        }
        ctx.restore();
      }
    }
    // Hazy mountain ridges and a darker evergreen shoreline give the scene depth.
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#78949650', '#62877c60', '#345c4b65'][layer];
      ctx.beginPath(); ctx.moveTo(0, height);
      for (let x = 0; x <= width + 4; x += 4) {
        const y = height * (0.76 + layer * 0.065) +
          Math.sin(x * 0.003 + layer * 2) * 38 + Math.sin(x * 0.009 + layer) * 17 +
          Math.sin(x * 0.031 + layer) * 5 + Math.sin(x * 0.071) * 2;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height); ctx.closePath(); ctx.fill();
    }
    const waterline = height * 0.86;
    const water = ctx.createLinearGradient(0, waterline, 0, height);
    water.addColorStop(0, w.day ? '#9bb5b5' : '#354e63');
    water.addColorStop(1, w.day ? '#526f73' : '#1c3445');
    ctx.fillStyle = water; ctx.fillRect(0, waterline, width, height - waterline);
    for (let i = 0; i < 65; i++) {
      const p = particles[i], depth = (i + 1) / 65;
      const x = p.x * width + Math.sin(time * (0.4 + depth) + i) * (1 + w.wind * 0.08);
      const y = waterline + depth * (height - waterline);
      const reflection = Math.max(0, 1 - Math.abs(x - sunX) / (width * 0.3));
      ctx.strokeStyle = `rgba(224,235,226,${(0.04 + reflection * 0.16) * (1 - w.cloud * 0.6)})`;
      ctx.lineWidth = 0.5 + depth;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + depth * 32, y); ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const x = i * width / 69, y = height * 0.96 + Math.sin(i * 1.7) * 14;
      const size = 18 + particles[i].depth * 38;
      const sway = treeSway(w, time, i * 0.2) * size * 0.14;
      ctx.fillStyle = '#294c3d70'; ctx.strokeStyle = '#34504465'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sway, y - size); ctx.stroke();
      for (let branch = 1; branch <= 9; branch++) {
        const top = y - size + branch * size / 11;
        const spread = branch * size / 33;
        const center = x + sway * (1 - branch / 11);
        ctx.beginPath(); ctx.moveTo(center, top - size * 0.12);
        ctx.lineTo(center - spread, top + size * 0.12);
        ctx.lineTo(center - spread * 0.3, top + size * 0.08);
        ctx.lineTo(center, top + size * 0.17);
        ctx.lineTo(center + spread, top + size * 0.12);
        ctx.closePath(); ctx.fill();
      }
    }
    // Foreground branches flex from fixed roots; leaf flutter is faster than trunk sway.
    for (let tree = 0; tree < 2; tree++) {
      const side = tree ? -1 : 1;
      const root = tree ? width + 12 : -12;
      const size = Math.min(height * 0.38, 320);
      const bend = treeSway(w, time, tree * 1.6) * size * 0.16;
      const tipX = root + side * size * 0.2 + bend;
      const tipY = height - size;
      ctx.strokeStyle = w.day ? '#394b3cce' : '#1b302dd9';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(root, height);
      ctx.bezierCurveTo(root, height - size * 0.45, tipX - bend * 0.4, tipY + size * 0.25, tipX, tipY);
      ctx.stroke();
      for (let branch = 0; branch < 7; branch++) {
        const level = (branch + 2) / 10;
        const baseX = root + (tipX - root) * level * level;
        const baseY = height - size * level;
        const reach = size * (0.2 + particles[branch + tree * 7].x * 0.25);
        const endX = baseX + side * reach + bend * level * 0.4;
        const endY = baseY - size * 0.13;
        ctx.lineWidth = 1.2 + (1 - level) * 2;
        ctx.beginPath(); ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(baseX + side * reach * 0.5, baseY, endX, endY); ctx.stroke();
        for (let leaf = 0; leaf < 6; leaf++) {
          const t = (leaf + 1) / 6;
          const seed = particles[tree * 42 + branch * 6 + leaf];
          const flutter = Math.sin(time * 3.2 + seed.x * 20) * Math.min(w.wind / 12, 1);
          const x = baseX + (endX - baseX) * t;
          const y = baseY + (endY - baseY) * t * t + (leaf % 2 ? -7 : 7);
          ctx.save(); ctx.translate(x, y);
          ctx.rotate(side * -0.5 + flutter * 0.55);
          ctx.scale(1, 0.65 + flutter * 0.25);
          ctx.fillStyle = (w.day ? ['#697448d9', '#9b8048cf', '#62774cda'] : ['#344c3ed9', '#53523ad9', '#2a493ed9'])[leaf % 3];
          ctx.beginPath(); ctx.ellipse(0, 0, 7 + seed.depth * 4, 3 + seed.depth * 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
    if (w.fog) {
      const fog = ctx.createLinearGradient(0, height * 0.4, 0, height);
      fog.addColorStop(0, '#e4e9e600'); fog.addColorStop(1, '#e4e9e6ca');
      ctx.fillStyle = fog; ctx.fillRect(0, 0, width, height);
    }
    if (w.wet > 0 || w.snow) {
      const count = w.snow ? 65 : Math.min(160, 45 + w.wet * 22);
      for (let i = 0; i < count; i++) {
        const p = particles[i], speed = (w.snow ? 22 : 410) * p.depth;
        const flutter = w.snow ? Math.sin(time * 0.8 + i) * 14 * p.depth : 0;
        const x = wrap(p.x * width + drift * p.depth + flutter, width + 40) - 20;
        const y = wrap(p.y * height + time * speed, height + 40) - 20;
        ctx.strokeStyle = `rgba(224,239,245,${0.22 + p.depth * 0.2})`;
        ctx.lineWidth = p.depth;
        ctx.beginPath();
        if (w.snow) {
          ctx.fillStyle = `rgba(245,250,251,${0.4 + p.depth * 0.3})`;
          ctx.arc(x, y, p.depth * 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.moveTo(x, y); ctx.lineTo(x + horizontal * 0.035, y + 16 * p.depth); ctx.stroke();
        }
      }
    }
    if (w.wind >= 3 && Math.abs(horizontal) > 1 && !w.snow) {
      for (let i = 0; i < Math.min(18, 3 + Math.floor(w.wind / 3)); i++) {
        const p = particles[i], direction = horizontal < 0 ? -1 : 1;
        const x = wrap(p.x * width + drift * 1.5 * p.depth, width + 80) - 40;
        const y = wrap(p.y * height + time * 20 + Math.sin(time * 1.4 + i) * 25, height + 80) - 40;
        ctx.save(); ctx.translate(x, y); ctx.rotate(time * direction * 1.4 + i + Math.sin(time + i) * 0.4);
        ctx.scale(1, 0.2 + Math.abs(Math.sin(time * 2.1 + i)) * 0.8);
        ctx.fillStyle = ['#997344aa', '#b18a45aa', '#6b784eaa'][i % 3];
        ctx.beginPath(); ctx.ellipse(0, 0, 4 + 7 * p.depth, 2 + 3 * p.depth, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#514a36aa'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(-6 * p.depth, 0); ctx.lineTo(9 * p.depth, 0); ctx.stroke(); ctx.restore();
      }
    }
  }

  function paint() {
    render(ctx, width, height);
  }

  function tick(now) {
    frame = 0;
    if (paused || document.hidden || !weather) return;
    if (now - last >= 33) {
      time += Math.min((now - (last || now)) / 1000, 0.1);
      last = now; paint();
    }
    frame = requestAnimationFrame(tick);
  }
  function animate() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    paint();
    if (!paused && !document.hidden && weather) frame = requestAnimationFrame(tick);
    button.textContent = paused ? 'Play scenery' : 'Pause scenery';
    button.setAttribute('aria-pressed', String(paused));
  }
  function resize() {
    width = innerWidth; height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }
  async function update() {
    request?.abort(); request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch(WEATHER_URL, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}`);
      weather = parseWeather(await response.json());
      status.textContent = weatherLabel(weather); animate();
    } catch (error) {
      status.textContent = weather
        ? `${weatherLabel(weather)} (refresh failed; showing last update)`
        : 'Seattle weather unavailable. Scenery will appear when the weather service reconnects.';
      console.warn('Seattle weather update failed:', error);
    } finally {
      clearTimeout(timeout);
    }
  }
  button.addEventListener('click', () => { paused = !paused; animate(); });
  motion.addEventListener('change', () => { paused = motion.matches; animate(); });
  document.addEventListener('visibilitychange', animate);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => { clearInterval(refresh); request?.abort(); cancelAnimationFrame(frame); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { update(); refresh = setInterval(update, 15 * 60 * 1000); }
  });
  resize(); animate(); update();
  refresh = setInterval(update, 15 * 60 * 1000);
}

if (typeof document !== 'undefined') startWeather();
