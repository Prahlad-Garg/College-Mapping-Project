  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 0;
  `;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;
  let mouse = { x: -999, y: -999 };
  const STAR_COUNT = 150;
  const REACT_RADIUS = 120;

  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    baseR: Math.random() * 1.8 + 0.6,
    r: 0,
    twinkleSpeed: Math.random() * 0.02 + 0.005,
    twinkleOffset: Math.random() * Math.PI * 2,
    alpha: 0
  }));

  window.addEventListener('resize', () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = -999;
    mouse.y = -999;
  });

  let t = 0;

  function animate() {
    ctx.clearRect(0, 0, W, H);
    t += 1;

    for (let s of stars) {
      const dx = s.x - mouse.x;
      const dy = s.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const proximity = Math.max(0, 1 - dist / REACT_RADIUS);

      const targetR = s.baseR + proximity * 3;
      const targetAlpha = 0.55 + proximity * 0.7;

      s.r += (targetR - s.r) * 0.08;
      s.alpha += (targetAlpha - s.alpha) * 0.08;

      const twinkle = Math.sin(t * s.twinkleSpeed + s.twinkleOffset) * 0.15;

      if (proximity > 0.1) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.1, s.r), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, s.alpha + twinkle)})`;
      ctx.fill();
    }

    requestAnimationFrame(animate);
  }

  animate();