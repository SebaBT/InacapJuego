import { CanvasTexture, ClampToEdgeWrapping, NearestFilter, NearestMipmapLinearFilter, RepeatWrapping } from 'three';

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function canvasTexture(width, height, draw, repeats = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = repeats ? RepeatWrapping : ClampToEdgeWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

// Periodic patches of wear keep the large surfaces continuous across repeats.
export function patina(ctx, w, h, rgb, strength, seed) {
  const rng = random(seed);
  const layers = [4, 12, 32].map(n => ({
    n, values: Float32Array.from({ length: n * n }, () => rng() - .5)
  }));
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let grain = (rng() - .5) * .75;
      for (let i = 0; i < layers.length; i++) {
        const { n, values } = layers[i];
        const px = x / w * n, py = y / h * n;
        const ix = Math.floor(px), iy = Math.floor(py);
        const fx = px - ix, fy = py - iy;
        const nextX = (ix + 1) % n, nextY = (iy + 1) % n;
        const a = values[iy * n + ix] * (1 - fx) + values[iy * n + nextX] * fx;
        const b = values[nextY * n + ix] * (1 - fx) + values[nextY * n + nextX] * fx;
        grain += (a * (1 - fy) + b * fy) / (1 + i * .4);
      }
      const k = 4 * (x + y * w);
      for (let ch = 0; ch < 3; ch++) image.data[k + ch] = rgb[ch] + grain * strength;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function fill(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function line(c, color, width, points) {
  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) c.lineTo(x, y);
  c.stroke();
}

function text(c, value, x, y, size, color, weight = 'normal') {
  c.font = weight + ' ' + size + 'px Arial, sans-serif';
  c.fillStyle = color;
  c.fillText(value, x, y);
}

function fasteners(c, w, h) {
  for (const x of [5, w - 6]) for (const y of [5, h - 6]) {
    fill(c, '#26312d', x, y, 3, 3);
    fill(c, '#adb4a6', x, y, 2, 1);
  }
}

function floorTiles() {
  return canvasTexture(256, 256, (c, w, h) => {
    patina(c, w, h, [216, 215, 202], 13, 193);
    const rng = random(94), size = 32;
    for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
      fill(c, 'rgba(90,85,67,' + rng() * .13 + ')', x, y, size, size);
      fill(c, '#87897c', x, y, size, 1);
      fill(c, '#898b7f', x, y, 1, size);
      fill(c, '#f2edd433', x + 1, y + 1, size - 2, 1);
      fill(c, '#565a4b26', x + 1, y + size - 1, size - 1, 1);
      if (rng() < .18) {
        const ox = x + 2 + rng() * 20, oy = y + 7 + rng() * 18;
        line(c, '#575c4a38', .8, [[ox, oy], [ox + 3, oy - 1], [ox + 6, oy - 3]]);
      }
      if (rng() < .13) fill(c, '#7576696b', x + 1, y + 1, 2, 1);
    }
    for (let i = 0; i < 1200; i++) fill(c, '#69645422', rng() * w, rng() * h, 1, 1);
  }, true);
}

function ceiling() {
  return canvasTexture(256, 256, (c, w, h) => {
    patina(c, w, h, [168, 170, 160], 15, 552);
    const rng = random(9);
    for (let i = 0; i < 2400; i++) {
      const x = rng() * w, y = rng() * h;
      fill(c, '#343e3842', x, y, 1 + rng() * 2, 1);
    }
    for (let i = 0; i < 256; i += 64) {
      fill(c, '#71796e', i, 0, 2, h);
      fill(c, '#c1c6b6', i + 2, 0, 1, h);
    }
    for (let i = 0; i < 256; i += 128) {
      fill(c, '#6d766c', 0, i, w, 2);
      fill(c, '#c1c6b6', 0, i + 2, w, 1);
    }
  }, true);
}

function wood() {
  return canvasTexture(128, 256, (c, w, h) => {
    patina(c, w, h, [143, 102, 68], 14, 32);
    const rng = random(84);
    for (let i = 0; i < 540; i++) {
      const x = rng() * w, y = rng() * h;
      line(c, rng() < .6 ? '#3d241819' : '#dfba8f28', .6 + rng(),
        [[x, y], [x + rng() * 2 - 1, y + 12], [x + rng() * 2 - 1, y + rng() * 75 + 16]]);
    }
    for (const x of [26, 68, 105]) fill(c, '#38271d28', x, 0, 1, h);
  }, true);
}

function paintedWall() {
  return canvasTexture(256, 128, (c, w, h) => {
    patina(c, w, h, [96, 122, 111], 16, 45);
    const rng = random(719);
    for (let i = 0; i < 20; i++) {
      const x = rng() * w, y = 20 + rng() * (h - 24);
      const length = 2 + rng() * 13;
      line(c, '#293b352e', .75, [[x, y], [x + length * .3, y], [x + length, y + 1]]);
      if (i % 4 === 0) fill(c, '#c8c5a960', x + 1, y + 1, length * .45, 1);
    }
    for (let i = 0; i < 7; i++) {
      const x = rng() * w, y = 54 + rng() * 60;
      fill(c, '#a9aa9480', x, y, 2, 1);
      fill(c, '#a9aa9445', x + 1, y - 1, 3, 1);
    }
  }, true);
}

function wiredGlass(warm) {
  return canvasTexture(64, 128, (c, w, h) => {
    patina(c, w, h, warm ? [180, 130, 71] : [83, 108, 108], 24, warm ? 65 : 54);
    const shade = c.createLinearGradient(0, 0, 48, h);
    shade.addColorStop(0, '#11252c12');
    shade.addColorStop(.55, warm ? '#f1c67933' : '#afbdb128');
    shade.addColorStop(1, '#17202185');
    fill(c, shade, 0, 0, w, h);
    for (let x = -h; x < w + h; x += 11) {
      line(c, '#20262155', .85, [[x, 0], [x + h, h]]);
      line(c, '#20262155', .85, [[x, 0], [x - h, h]]);
    }
  });
}

function campusWindow(seed) {
  return canvasTexture(320, 144, (c, w, h) => {
    const rng = random(seed);
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#243542');
    sky.addColorStop(.74, '#617783');
    sky.addColorStop(1, '#4b6266');
    fill(c, sky, 0, 0, w, h);
    for (let x = -18; x < w;) {
      const bw = 25 + Math.floor(rng() * 64), by = 62 + Math.floor(rng() * 36);
      fill(c, '#2b3c42', x, by, bw, h - by);
      fill(c, '#536169', x, by, bw, 2);
      if (rng() < .6) fill(c, '#32434b', x + 6, by - 4, 11, 4);
      for (let wy = by + 8; wy < h; wy += 12) for (let wx = x + 5; wx < x + bw - 5; wx += 10) {
        fill(c, rng() < .13 ? '#9e9677' : '#3d5056', wx, wy, 5, 4);
      }
      x += bw;
    }
    for (let i = 0; i < 36; i++) {
      const x = rng() * w, y = 101 + rng() * 31;
      c.fillStyle = '#263a3d';
      c.beginPath();
      c.moveTo(x - 10, h);
      for (let j = -4; j <= 4; j++) c.lineTo(x + j * 3, y + Math.abs(j) * 2 + rng() * 6);
      c.lineTo(x + 16, h); c.fill();
    }
    fill(c, '#293c452b', 0, 0, w, h);
    line(c, '#c6dcc538', 1, [[17, 21], [76, 24]]);
    line(c, '#c6dcc528', 1, [[18, 23], [77, 26]]);
    for (let i = 0; i < 1500; i++) fill(c, '#bbcbd112', rng() * w, rng() * h, 1, 1);
  });
}

function directory() {
  return canvasTexture(448, 168, (c, w, h) => {
    patina(c, w, h, [45, 65, 62], 10, 21);
    fill(c, '#a7553d', 8, 8, 132, h - 16);
    text(c, 'B', 22, 130, 132, '#f2eddb', 'bold');
    text(c, 'PABELLÓN', 159, 49, 29, '#eeecdb', 'bold');
    fill(c, '#c8c7b28a', 159, 63, 267, 2);
    text(c, 'Docencia', 159, 100, 26, '#e4e5d5');
    text(c, 'Salas 101 – 106', 159, 137, 20, '#c9d2c4');
    line(c, '#ececd9', 5, [[384, 123], [416, 123], [405, 112]]);
    line(c, '#ececd9', 5, [[416, 123], [405, 134]]);
    fasteners(c, w, h);
  });
}

export function roomPlate(number, lab = false, subject = lab ? 'LABORATORIO' : 'SALA DE CLASES') {
  return canvasTexture(192, 96, (c, w, h) => {
    fill(c, '#e1dfca', 0, 0, w, h);
    fill(c, '#a9553e', 0, 0, 9, h);
    if (String(number) === '107') {
      text(c, 'CASETA 107', 18, 49, 25, '#2c413e', 'bold');
    } else {
      text(c, 'B-' + number, 20, 56, 44, '#2c413e', 'bold');
    }
    fill(c, '#82918a', 20, 64, 152, 1);
    text(c, subject, 21, 83, 13, '#334840', 'bold');
  });
}

function bulletin() {
  return canvasTexture(512, 256, (c, w, h) => {
    patina(c, w, h, [134, 99, 66], 42, 172);
    const rng = random(74);
    function sheet(x, y, pw, ph, angle, color, draw) {
      c.save(); c.translate(x, y); c.rotate(angle);
      fill(c, '#30291d65', 2, 3, pw, ph);
      fill(c, color, 0, 0, pw, ph);
      draw();
      fill(c, '#a34732', pw * .5 - 2, 3, 4, 4);
      fill(c, '#d0986d', pw * .5 - 2, 3, 2, 1);
      c.restore();
    }
    function copy(x, y, width, count, color) {
      for (let i = 0; i < count; i++) fill(c, color, x, y + i * 6, width * (.40 + rng() * .6), 1);
    }
    sheet(13, 19, 150, 203, -.027, '#e7dfc7', () => {
      text(c, 'CINE', 8, 52, 49, '#243e3b', 'bold');
      text(c, 'CLUB', 8, 94, 49, '#243e3b', 'bold');
      fill(c, '#ad5a40', 8, 104, 134, 69);
      for (let i = 0; i < 5; i++) {
        c.beginPath(); c.arc(72, 140, 7 + i * 7, 0, 2 * Math.PI);
        c.strokeStyle = '#e6d6ac'; c.lineWidth = 2; c.stroke();
      }
      text(c, 'AUDITORIO B', 9, 193, 13, '#243e3b', 'bold');
    });
    sheet(181, 14, 167, 100, .018, '#dedfd3', () => {
      text(c, 'HORARIO DE SALAS', 8, 22, 14, '#34494a', 'bold');
      for (let i = 0; i < 6; i++) fill(c, '#7e8981', 8, 32 + i * 10, 150, 1);
      for (let i = 0; i < 6; i++) fill(c, '#7e8981', 8 + i * 30, 32, 1, 51);
    });
    sheet(188, 129, 84, 105, -.07, '#c3cebd', () => {
      text(c, 'AVISO', 9, 25, 20, '#374943', 'bold'); copy(9, 39, 66, 9, '#6d7a70');
    });
    sheet(287, 143, 64, 79, .05, '#e7ddbb', () => copy(7, 17, 49, 8, '#7e7766'));
    sheet(370, 19, 123, 158, .036, '#a7503b', () => {
      text(c, 'TALLER', 8, 37, 24, '#f1dfb5', 'bold'); text(c, 'ABIERTO', 8, 62, 21, '#f1dfb5', 'bold');
      for (let i = 0; i < 6; i++) line(c, '#e0cc9d', 2, [[9 + i * 5, 130], [60 + i * 5, 78], [84 + i * 4, 128]]);
      fill(c, '#e0cc9d', 9, 142, 64, 2);
    });
    sheet(377, 191, 99, 49, -.03, '#dedacc', () => copy(8, 14, 80, 4, '#747a6e'));
    fasteners(c, w, h);
  });
}

function exitSign() {
  return canvasTexture(256, 72, (c, w, h) => {
    fill(c, '#397050', 0, 0, w, h);
    c.strokeStyle = '#d0e5c4'; c.lineWidth = 2; c.strokeRect(4, 4, w - 8, h - 8);
    fill(c, '#d9ebd0', 13, 14, 6, 44); fill(c, '#d9ebd0', 13, 14, 19, 5);
    c.fillStyle = '#e6efdb'; c.beginPath(); c.arc(44, 21, 5, 0, Math.PI * 2); c.fill();
    line(c, '#e6efdb', 6, [[27, 35], [34, 28], [43, 30], [49, 38], [57, 38]]);
    line(c, '#e6efdb', 7, [[40, 29], [33, 42], [45, 48], [43, 58]]);
    line(c, '#e6efdb', 6, [[34, 41], [26, 51], [19, 51]]);
    text(c, 'SALIDA', 73, 50, 40, '#dfefd6', 'bold');
  });
}

function fireSign() {
  return canvasTexture(64, 84, (c, w, h) => {
    fill(c, '#e6dfcb', 0, 0, w, h); fill(c, '#a44031', 3, 3, w - 6, 60);
    fill(c, '#efe6d5', 24, 24, 17, 31); fill(c, '#efe6d5', 27, 19, 12, 7);
    line(c, '#efe6d5', 3, [[29, 18], [35, 14], [42, 16], [48, 27], [48, 34]]);
    text(c, 'EXTINTOR', 5, 76, 11, '#6b3b32', 'bold');
  });
}

function chalkboard() {
  return canvasTexture(256, 128, (c, w, h) => {
    patina(c, w, h, [29, 53, 44], 12, 311);
    const rng = random(409);
    for (let i = 0; i < 48; i++) {
      fill(c, 'rgba(215,222,208,' + (0.015 + rng() * 0.03) + ')', rng() * w, rng() * h, 14 + rng() * 44, 4 + rng() * 14);
    }
    line(c, '#c9d4c255', 1.2, [[22, 28], [88, 28]]);
    text(c, 'SISTEMAS II', 24, 24, 10, '#cfd8c6a6', 'bold');
    line(c, '#cfd8c655', 1, [[24, 46], [62, 46], [56, 56]]);
    text(c, 'f(x) = dx/dt', 24, 62, 11, '#cad4c288');
    for (let i = 0; i < 4; i++) {
      const y = 76 + i * 9;
      fill(c, '#cfd8c638', 24, y, 36 + rng() * 54, 1);
    }
    text(c, 'NO ABRIR 102', 142, 86, 11, '#d8dfd06e', 'bold');
    fill(c, '#3e2d22', 0, h - 5, w, 5);
  });
}

function crtScreen() {
  return canvasTexture(128, 96, (c, w, h) => {
    patina(c, w, h, [14, 34, 31], 8, 701);
    fill(c, '#0e2420', 6, 6, w - 12, h - 12);
    for (let y = 6; y < h - 6; y += 3) fill(c, '#05100e55', 6, y, w - 12, 1);
    text(c, 'SYS://PAB-B', 11, 20, 9, '#62d4a4', 'bold');
    fill(c, '#4ab88c', 11, 25, 62, 1);
    text(c, '> RED: OK', 11, 39, 8, '#7ce0b6');
    text(c, '> CAM_04: ERR', 11, 51, 8, '#d4845a');
    text(c, '> PUERTA 106', 11, 63, 8, '#7ce0b6');
    fill(c, '#8ef0c4', 11, 72, 6, 9);
  });
}

function breakerPanel() {
  return canvasTexture(128, 192, (c, w, h) => {
    patina(c, w, h, [64, 72, 68], 10, 512);
    fill(c, '#2d3531', 10, 12, w - 20, h - 24);
    for (let x = 10; x < w - 10; x += 12) {
      fill(c, x % 24 === 10 ? '#c49b38' : '#252b28', x, 14, 8, 7);
    }
    text(c, 'TABLERO B', 22, 36, 11, '#dad9c5', 'bold');
    for (let r = 0; r < 6; r++) {
      const y = 48 + r * 20;
      fill(c, '#1c221f', 20, y, w - 40, 14);
      fill(c, r === 1 || r === 4 ? '#a34836' : '#5f6b63', 26, y + 3, 24, 8);
      fill(c, '#8d9689', 58, y + 3, 24, 8);
      fill(c, r % 2 === 0 ? '#67b97c' : '#c65a44', w - 32, y + 5, 4, 4);
    }
  });
}

function drawingSheet() {
  return canvasTexture(128, 96, (c, w, h) => {
    patina(c, w, h, [201, 204, 184], 9, 315);
    c.strokeStyle = '#606e65'; c.lineWidth = 1;
    c.strokeRect(5, 5, w - 10, h - 10);
    for (const [x, y] of [[17, 46], [46, 30], [78, 47]]) {
      line(c, '#415c57', 1, [[x, y], [x + 14, y - 8], [x + 29, y], [x + 15, y + 8], [x, y], [x, y + 14], [x + 15, y + 22], [x + 29, y + 14], [x + 29, y]]);
      line(c, '#62796e', 1, [[x + 15, y + 8], [x + 15, y + 22]]);
    }
    text(c, 'ISOMÉTRICA', 10, 16, 7, '#465a54', 'bold');
    line(c, '#808a79', 1, [[6, 78], [122, 78]]);
    text(c, 'LÁM. 03', 89, 87, 6, '#465a54');
  });
}

function scopeScreen() {
  return canvasTexture(64, 40, (c, w, h) => {
    fill(c, '#172e2b', 0, 0, w, h);
    for (let x = 4; x < w; x += 8) fill(c, '#385147', x, 2, 1, h - 4);
    for (let y = 4; y < h; y += 8) fill(c, '#385147', 2, y, w - 4, 1);
    const trace = Array.from({ length: 30 }, (_, i) => [3 + i * 2, 19 - Math.round(10 * Math.sin(i * .48))]);
    line(c, '#97c994', 1, trace);
  });
}

function plazaPavement() {
  return canvasTexture(256, 256, (c, w, h) => {
    patina(c, w, h, [76, 82, 78], 16, 613);
    const rng = random(619), rowH = 32, colW = 64;
    for (let row = 0; row * rowH < h; row++) {
      const y = row * rowH;
      const offset = (row % 2) * (colW / 2);
      for (let x = -offset; x < w; x += colW) {
        const px = (x + w) % w;
        const shade = rng() * .20;
        fill(c, 'rgba(20,26,23,' + shade + ')', x, y, colW, rowH);
        fill(c, '#252c28', x, y, colW, 2);
        fill(c, '#272e2a', x, y, 2, rowH);
        fill(c, '#8893862e', x + 2, y + 2, colW - 4, 1);
        if (rng() < .35) {
          const mx = x + 3 + rng() * (colW - 14), my = y + 2 + rng() * (rowH - 8);
          fill(c, 'rgba(42,64,40,' + (.28 + rng() * .3) + ')', mx, my, 6 + rng() * 10, 3 + rng() * 5);
        }
        if (rng() < .28) {
          const cx = px + 8 + rng() * (colW - 18), cy = y + 6 + rng() * (rowH - 12);
          line(c, '#1c2320aa', .9, [[cx, cy], [cx + 5, cy + 3], [cx + 11, cy + 1], [cx + 15, cy + 6]]);
        }
      }
    }
    for (let i = 0; i < 1600; i++) fill(c, '#1f26232c', rng() * w, rng() * h, 1, 1);
  }, true);
}

function bark() {
  return canvasTexture(128, 256, (c, w, h) => {
    patina(c, w, h, [62, 53, 47], 16, 827);
    const rng = random(829);
    for (let i = 0; i < 160; i++) {
      const x = rng() * w, y = rng() * h, len = 24 + rng() * 72;
      const col = rng() < .55 ? '#20191578' : '#73655a44';
      line(c, col, .8 + rng() * 1.4, [[x, y], [x + (rng() - .5) * 4, y + len * .45], [x + (rng() - .5) * 5, y + len]]);
    }
    for (let i = 0; i < 14; i++) {
      const kx = rng() * w, ky = rng() * h;
      c.strokeStyle = '#241c1788';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(kx, ky, 4 + rng() * 6, 0, Math.PI * 2);
      c.stroke();
    }
    for (let i = 0; i < 90; i++) fill(c, '#44564044', rng() * w, rng() * h, 2 + rng() * 3, 2);
  }, true);
}

function foliage() {
  return canvasTexture(128, 128, (c, w, h) => {
    patina(c, w, h, [38, 52, 41], 16, 941);
    const rng = random(947);
    for (let i = 0; i < 240; i++) {
      const x = rng() * w, y = rng() * h;
      const tones = ['#1e2e21', '#2b3e2c', '#384c33', '#465038'];
      fill(c, tones[Math.floor(rng() * tones.length)], x, y, 4 + rng() * 7, 3 + rng() * 6);
    }
    for (let i = 0; i < 45; i++) {
      const x = rng() * w, y = rng() * h;
      line(c, '#2a211a85', 1, [[x, y], [x + (rng() - .5) * 14, y - 6 - rng() * 10]]);
    }
  }, true);
}

function nightSky() {
  return canvasTexture(256, 256, (c, w, h) => {
    patina(c, w, h, [12, 20, 36], 11, 1024);
    const rng = random(1049);
    // Soft hazy nocturnal cloud swirls tiled seamlessly across edges
    for (let i = 0; i < 28; i++) {
      const cx = rng() * w, cy = rng() * h;
      const rx = 28 + rng() * 52, ry = 12 + rng() * 22;
      const darkBand = i % 4 === 0;
      const core = darkBand ? 'rgba(6,11,22,0.26)' : i % 2 ? 'rgba(30,48,74,0.16)' : 'rgba(20,35,58,0.18)';
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const px = cx + ox, py = cy + oy;
        if (px + rx < 0 || px - rx > w || py + ry < 0 || py - ry > h) continue;
        c.save();
        c.translate(px, py);
        c.scale(1, ry / rx);
        const g = c.createRadialGradient(0, 0, 1, 0, 0, rx);
        g.addColorStop(0, core);
        g.addColorStop(0.55, darkBand ? 'rgba(6,11,22,0.09)' : 'rgba(18,32,54,0.06)');
        g.addColorStop(1, 'rgba(12,20,36,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, rx, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
    // Subtle muted stars without harsh bright patches
    const starTones = ['#566d8855', '#6982a066', '#7b95b366', '#4a5f784d'];
    for (let i = 0; i < 65; i++) {
      const sx = Math.floor(rng() * w), sy = Math.floor(rng() * h);
      fill(c, starTones[i % starTones.length], sx, sy, 1, 1);
    }
  }, true);
}

function securityMonitor() {
  return canvasTexture(128, 96, (c, w, h) => {
    patina(c, w, h, [11, 24, 21], 7, 733);
    fill(c, '#0a1916', 5, 5, w - 10, h - 10);
    const hw = (w - 14) / 2, hh = (h - 14) / 2;
    for (let q = 0; q < 4; q++) {
      const qx = 6 + (q % 2) * (hw + 2), qy = 6 + Math.floor(q / 2) * (hh + 2);
      fill(c, q === 3 ? '#1c1210' : '#102924', qx, qy, hw, hh);
      c.strokeStyle = '#386b59';
      c.lineWidth = 1;
      c.strokeRect(qx, qy, hw, hh);
      const label = ['CAM1 PLAZA', 'CAM2 HALL', 'CAM3 ANEXO', 'CAM4 PORTON'][q];
      text(c, label, qx + 3, qy + 9, 6, q === 3 ? '#d8825a' : '#7ae2b5', 'bold');
      if (q === 0) {
        fill(c, '#22493f', qx + 18, qy + 16, 16, 16);
        fill(c, '#8ef0c4', qx + 25, qy + 13, 3, 3);
      } else if (q === 1) {
        line(c, '#4da886', 1, [[qx + 6, qy + 34], [qx + 22, qy + 18], [qx + 34, qy + 18], [qx + 50, qy + 34]]);
      } else if (q === 2) {
        for (let s = 0; s < 4; s++) fill(c, '#3e7f68', qx + 12 + s * 6, qy + 28 - s * 3, 18, 2);
      } else {
        text(c, 'SIN SENAL', qx + 9, qy + 24, 6, '#e27454', 'bold');
      }
    }
    for (let y = 5; y < h - 5; y += 3) fill(c, '#040c0a55', 5, y, w - 10, 1);
    text(c, 'REC 03:17', 8, h - 7, 6, '#e07a5a', 'bold');
  });
}

export function makeTextures() {
  return {
    white: canvasTexture(1, 1, c => fill(c, '#fff', 0, 0, 1, 1)),
    floor: floorTiles(), ceiling: ceiling(), wood: wood(),
    plaster: canvasTexture(256, 256, (c, w, h) => patina(c, w, h, [197, 196, 178], 17, 910), true),
    paint: paintedWall(),
    glass: wiredGlass(false), amberGlass: wiredGlass(true),
    windows: [campusWindow(81), campusWindow(910)],
    directory: directory(), bulletin: bulletin(), exit: exitSign(), fire: fireSign(),
    chalkboard: chalkboard(), crtScreen: crtScreen(), breakerPanel: breakerPanel(),
    drawingSheet: drawingSheet(), scopeScreen: scopeScreen(),
    plazaPavement: plazaPavement(), bark: bark(), foliage: foliage(), nightSky: nightSky(), securityMonitor: securityMonitor()
  };
}

