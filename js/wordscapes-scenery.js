/**
 * Wordscapes-Style 3D Living Environment Engine
 * ---------------------------------------------
 * Authentic, living photographic environments faithfully displaying the 5 reference photos:
 *   1. 🌸 Blossom Park   - Lush park lawn, blooming trees & mountain ridges (images/scenery/sakura.jpg)
 *   2. 🌋 Volcano Night   - Erupting volcano caldera & molten lava fountains (images/scenery/volcano.jpg)
 *   3. 🏔️ Winter Village  - Twilight snow valley, glowing chalet windows & lights (images/scenery/snowtown.jpg)
 *   4. ❄️ Alpine Peaks    - High-altitude powder snow peaks & ski slopes (images/scenery/peaks.jpg)
 *   5. 🏝️ Tropical Pier   - Crystal turquoise lagoon & wooden boardwalk (images/scenery/ocean.jpg)
 *
 * Immersive Architecture:
 *   - Edge-to-edge authentic photographic backdrops with GPU-composited living Ken Burns motion.
 *   - Living environmental lighting (volcano heat convection pulses, chalet window warmth, ocean caustics).
 *   - Multi-layer depth: 3D in-scene particles PLUS a dedicated high-DPI foreground FX canvas where
 *     particles visibly pass physically IN FRONT OF the letter racks and tiles!
 *   - Locked 60 FPS, zero garbage collection.
 */
(function (global) {
	'use strict';

	// Strictly Android-only detection so iOS (WKWebView / Safari) remains 100% untouched
	var IS_ANDROID = (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')) ||
		(typeof window !== 'undefined' && !!window.AndroidHaptics);

	var sceneRef = null;
	var cameraRef = null;
	var rendererRef = null;

	var currentScenery = 'sakura';
	var dynamicPointLight = null;

	// Foreground Canvas FX state (Disabled: particles stay BEHIND the board)
	var fgCanvas = null;
	var fgCtx = null;
	var fgWidth = 0;
	var fgHeight = 0;
	var fgDpr = 1;
	var fgParticles = [];
	var fgMaxParticles = 0;

	// Background Particle Canvas (Passes BEHIND the 3D playing board)
	var bgCanvas = null;
	var bgCtx = null;
	var bgWidth = 0;
	var bgHeight = 0;
	var bgDpr = 1;
	var bgParticles = [];
	var branchSnowDrops = [];
	var nextBranchDropTime = 0;
	var bgMaxParticles = 48;

	// Three.js 3D in-scene particle systems
	var particleSystems3D = {};
	var activeParticles3D = null;
	var particleTextures = {};

	var SCENERIES = {
		sakura: {
			id: 'sakura',
			name: 'Blossom Park',
			icon: '🌸',
			photo: 'images/scenery/3d/sakura.jpg',
			vignetteClass: 'scenery-vignette-sakura',
			glowClass: 'scenery-glow-sakura',
			particleType: 'petal',
			lighting: {
				ambient: { color: 0xffefe4, intensity: 0.70 },
				sun: { color: 0xfffaed, intensity: 1.10, pos: [4, 20, 10] },
				fill: { color: 0xffd9e8, intensity: 0.40, pos: [-8, 8, -6] },
				point: { color: 0xffe8cc, intensity: 1.4, pos: [0, 4, -1] }
			}
		},
		volcano: {
			id: 'volcano',
			name: 'Volcano Night',
			icon: '🌋',
			photo: 'images/scenery/3d/volcano.jpg',
			vignetteClass: 'scenery-vignette-volcano',
			glowClass: 'scenery-glow-volcano',
			particleType: 'ember',
			lighting: {
				ambient: { color: 0x4a1e12, intensity: 0.72 },
				sun: { color: 0xffaa66, intensity: 1.15, pos: [2, 22, 8] },
				fill: { color: 0x331008, intensity: 0.40, pos: [-8, 8, -6] },
				point: { color: 0xff5500, intensity: 2.2, pos: [0, 3.5, -3] }
			}
		},
		snowtown: {
			id: 'snowtown',
			name: 'Winter Village',
			icon: '🏔️',
			photo: 'images/scenery/3d/snowtown.jpg',
			vignetteClass: 'scenery-vignette-snowtown',
			glowClass: 'scenery-glow-snowtown',
			particleType: 'snow',
			lighting: {
				ambient: { color: 0x303e5c, intensity: 0.70 },
				sun: { color: 0x9ec0e6, intensity: 0.85, pos: [4, 18, 10] },
				fill: { color: 0xffb355, intensity: 0.48, pos: [-6, 6, -10] },
				point: { color: 0xffbb44, intensity: 2.0, pos: [0, 3.2, -2] }
			}
		},
		peaks: {
			id: 'peaks',
			name: 'Alpine Peaks',
			icon: '❄️',
			photo: 'images/scenery/3d/peaks.jpg',
			vignetteClass: 'scenery-vignette-peaks',
			glowClass: 'scenery-glow-peaks',
			particleType: 'crystal',
			lighting: {
				ambient: { color: 0xd8ebfc, intensity: 0.72 },
				sun: { color: 0xffffff, intensity: 1.15, pos: [5, 22, 8] },
				fill: { color: 0xa4d4ff, intensity: 0.42, pos: [-8, 8, -6] },
				point: { color: 0xfffaea, intensity: 1.2, pos: [0, 4, -1] }
			}
		},
		ocean: {
			id: 'ocean',
			name: 'Tropical Pier',
			icon: '🏝️',
			photo: 'images/scenery/3d/ocean.jpg',
			vignetteClass: 'scenery-vignette-ocean',
			glowClass: 'scenery-glow-ocean',
			particleType: 'none',
			lighting: {
				ambient: { color: 0xd6f7f7, intensity: 0.72 },
				sun: { color: 0xfffbe8, intensity: 1.15, pos: [4, 20, 10] },
				fill: { color: 0x76dddc, intensity: 0.42, pos: [-8, 8, -6] },
				point: { color: 0xfff0c8, intensity: 1.3, pos: [0, 4, -1] }
			}
		}
	};

	// Aliases for legacy saves
	SCENERIES.rain = SCENERIES.volcano;
	SCENERIES.sunlit = SCENERIES.ocean;
	SCENERIES.aurora = SCENERIES.snowtown;
	SCENERIES.autumn = SCENERIES.peaks;

	var SCENERY_CYCLE_ORDER = ['sakura', 'volcano', 'snowtown', 'peaks', 'ocean'];

	// Floating particles in the background behind the board:
	var PARTICLES_BEHIND_ENABLED = true;

	// --------------------------------------------------------------------------
	// LIVE BACKDROP (WebGL fragment shader that animates the portrait painting)
	// --------------------------------------------------------------------------
	// Mobile-portrait first: the source art is 768x1376 (9:16). The shader
	// cover-fits it to the viewport, then adds subtle living motion:
	//   - blossom canopies & hanging branches sway in the breeze
	//   - wind gusts roll across the lawn as moving light sheens
	//   - soft cloud shadows drift over the hills and grass
	//   - slowly rotating sun rays + gentle exposure "breathing"
	// Rendered at <=30fps and capped resolution to stay cool on phones.
	// All photographic scenes enabled for HD live ambient animation except 'peaks', 'ocean' and 'volcano',
	// which render as true real-time Three.js 3D scenes (Alpine Ski Resort, Tropical Pier & Volcano Night)!
	var LIVE_SCENES = { sakura: true, volcano: false, snowtown: true, peaks: false, ocean: false };

	var live = {
		supported: null,
		canvas: null,
		gl: null,
		prog: null,
		tex: null,
		texReady: false,
		texScene: null,
		uni: {},
		imgW: 768,
		imgH: 1376,
		active: false,
		fadeUntil: 0,
		lastDraw: 0,
		startTime: 0,
		width: 0,
		height: 0
	};

	var LIVE_VERT = [
		'attribute vec2 aPos;',
		'varying vec2 vUv;',
		'void main() {',
		'  vUv = aPos * 0.5 + 0.5;',
		'  gl_Position = vec4(aPos, 0.0, 1.0);',
		'}'
	].join('\n');

	var LIVE_FRAG_SAKURA = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uRes;',
		'uniform vec2 uImg;',
		'uniform float uTime;',
		'varying vec2 vUv;',
		'',
		'void main() {',
		'  float t = uTime;',
		'  // Exact pixel-perfect aspect cover fit of 768x1376 portrait art',
		'  float ca = uRes.x / uRes.y; float ia = uImg.x / uImg.y;',
		'  vec2 s = vec2(1.0);',
		'  if (ca > ia) { s.y = ia / ca; } else { s.x = ca / ia; }',
		'  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
		'  p = (p - 0.5) * s + 0.5;',
		'',
		'  // Ultra-subtle, smooth cinematic zoom float (0.6% amplitude, pure and crystal sharp)',
		'  float zoom = 1.025 + 0.006 * sin(t * 0.15);',
		'  p = (p - 0.5) / zoom + 0.5 + vec2(sin(t * 0.12), cos(t * 0.10)) * 0.0025;',
		'',
		'  // High-precision clean texture lookup',
		'  vec3 col = texture2D(uTex, p).rgb;',
		'',
		'  // Hanging upper blossom branches gentle sway (top 20% of screen only)',
		'  float topW = smoothstep(0.0, 0.08, p.y) * (1.0 - smoothstep(0.18, 0.28, p.y));',
		'  if (topW > 0.001) {',
		'    float sway = sin(t * 0.9 + p.x * 3.5) * 0.0035 * topW;',
		'    col = texture2D(uTex, p + vec2(sway, sway * 0.25)).rgb;',
		'  }',
		'',
		'  // Warm dynamic sunlit atmosphere from top right',
		'  vec2 sp = vec2(0.90, -0.05);',
		'  vec2 dv = p - sp;',
		'  float ang = atan(dv.y, dv.x);',
		'  float dist = length(dv);',
		'  float rays = 0.5 + 0.5 * sin(ang * 22.0 + t * 0.25) * sin(ang * 34.0 - t * 0.15 + 1.2);',
		'  rays = pow(rays, 2.0);',
		'  float fall = exp(-dist * 1.5);',
		'  vec3 sun = vec3(1.0, 0.94, 0.82);',
		'  float glow = exp(-dist * 3.5) * (0.18 + 0.06 * sin(t * 0.4));',
		'  vec3 add = sun * (rays * fall * 0.18 + glow);',
		'  col = 1.0 - (1.0 - col) * (1.0 - add);',
		'',
		'  // Natural breathing exposure & rich vivid color grading',
		'  col *= 1.0 + 0.025 * sin(t * 0.25);',
		'  float luma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(luma), col, 1.20);',
		'  col = pow(max(vec3(0.0), col), vec3(1.04));',
		'',
		'  // Rich contrast & deep night-sky saturation',
		'  float sLuma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(sLuma), col, 1.18);',
		'  col = pow(max(vec3(0.0), col), vec3(1.04));',
		'',
		'  gl_FragColor = vec4(col, 1.0);',
		'}'
	].join('\n');

	var LIVE_FRAG_VOLCANO = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uRes;',
		'uniform vec2 uImg;',
		'uniform float uTime;',
		'varying vec2 vUv;',
		'',
		'void main() {',
		'  float t = uTime;',
		'  float ca = uRes.x / uRes.y; float ia = uImg.x / uImg.y;',
		'  vec2 s = vec2(1.0);',
		'  if (ca > ia) { s.y = ia / ca; } else { s.x = ca / ia; }',
		'  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
		'  p = (p - 0.5) * s + 0.5;',
		'',
		'  // Camera breathing with slightly pulled-back scale for volcano',
		'  float zoom = 1.02 + 0.005 * sin(t * 0.16);',
		'  p = (p - 0.5) / zoom + 0.5 + vec2(sin(t * 0.14), cos(t * 0.11)) * 0.002;',
		'',
		'  vec3 col = texture2D(uTex, p).rgb;',
		'',
		'  // Erupting caldera molten core dynamic pulsing glow (around x=0.50, y=0.28)',
		'  vec2 calderaPos = vec2(0.50, 0.28);',
		'  float dCaldera = length(p - calderaPos);',
		'  float calderaGlow = exp(-dCaldera * 6.5) * (0.35 + 0.15 * sin(t * 1.8) + 0.08 * sin(t * 3.4));',
		'  vec3 magmaColor = vec3(1.0, 0.42, 0.05);',
		'  col += magmaColor * calderaGlow;',
		'',
		'  // Rising volcanic smoke convection drift at the top',
		'  if (p.y < 0.25) {',
		'    float smokeShift = sin(t * 0.6 + p.x * 5.0) * 0.0035 * (1.0 - p.y / 0.25);',
		'    col = mix(col, texture2D(uTex, p + vec2(smokeShift, -0.002)).rgb, 0.55);',
		'  }',
		'',
		'  // Flowing lava river heat shimmer (bottom area y > 0.68)',
		'  float lavaMask = smoothstep(0.12, 0.35, col.r - col.b) * smoothstep(0.68, 0.85, p.y);',
		'  float lavaPulse = 0.18 * sin(t * 2.2 - p.y * 12.0 + p.x * 6.0);',
		'  col += vec3(0.35, 0.12, 0.0) * lavaMask * (0.7 + lavaPulse);',
		'',
		'  // Deep obsidian blacks and rich magma saturation',
		'  float vLuma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(vLuma), col, 1.22);',
		'  col = pow(max(vec3(0.0), col), vec3(1.06));',
		'',
		'  // Rich contrast & deep night-sky saturation',
		'  float sLuma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(sLuma), col, 1.18);',
		'  col = pow(max(vec3(0.0), col), vec3(1.04));',
		'',
		'  gl_FragColor = vec4(col, 1.0);',
		'}'
	].join('\n');

	var LIVE_FRAG_SNOWTOWN = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uRes;',
		'uniform vec2 uImg;',
		'uniform float uTime;',
		'uniform vec4 uCars[3];',
		'uniform vec3 uCarProps[3];',
		'varying vec2 vUv;',
		'',
		'void main() {',
		'  float t = uTime;',
		'  float ca = uRes.x / uRes.y; float ia = uImg.x / uImg.y;',
		'  vec2 s = vec2(1.0);',
		'  if (ca > ia) { s.y = ia / ca; } else { s.x = ca / ia; }',
		'  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
		'  p = (p - 0.5) * s + 0.5;',
		'',
		'  // 1. Pine Trees Swaying in Winter Wind (grounded at trunk base)',
		'  vec2 swayDisp = vec2(0.0);',
		'  if (p.x < 0.48 && p.y > 0.58 && p.y < 0.96) {',
		'    // Tree 1 (front left)',
		'    float yF1 = clamp((0.945 - p.y) / 0.20, 0.0, 1.0);',
		'    float hw1 = 0.080 * (1.15 - 0.65 * yF1);',
		'    float dx1 = abs(p.x - 0.130);',
		'    if (dx1 < hw1 && p.y > 0.72) {',
		'      float w1 = smoothstep(hw1, hw1 * 0.4, dx1) * smoothstep(0.71, 0.75, p.y);',
		'      float s1 = 0.0075 * pow(yF1, 1.5) * (sin(t * 1.5) + 0.35 * sin(t * 2.8));',
		'      swayDisp.x += s1 * w1;',
		'      swayDisp.y -= abs(s1) * 0.25 * w1;',
		'    }',
		'    // Tree 2 (far left)',
		'    float yF2 = clamp((0.835 - p.y) / 0.165, 0.0, 1.0);',
		'    float hw2 = 0.055 * (1.15 - 0.65 * yF2);',
		'    float dx2 = abs(p.x - 0.045);',
		'    if (dx2 < hw2 && p.y > 0.65) {',
		'      float w2 = smoothstep(hw2, hw2 * 0.4, dx2) * smoothstep(0.64, 0.68, p.y);',
		'      float s2 = 0.0065 * pow(yF2, 1.5) * (sin(t * 1.5 + 0.8) + 0.35 * sin(t * 2.8 + 1.2));',
		'      swayDisp.x += s2 * w2;',
		'      swayDisp.y -= abs(s2) * 0.25 * w2;',
		'    }',
		'    // Tree 3 (left mid)',
		'    float yF3 = clamp((0.760 - p.y) / 0.110, 0.0, 1.0);',
		'    float hw3 = 0.048 * (1.15 - 0.65 * yF3);',
		'    float dx3 = abs(p.x - 0.140);',
		'    if (dx3 < hw3 && p.y > 0.63) {',
		'      float w3 = smoothstep(hw3, hw3 * 0.4, dx3) * smoothstep(0.62, 0.66, p.y);',
		'      float s3 = 0.0055 * pow(yF3, 1.5) * (sin(t * 1.5 + 1.5) + 0.35 * sin(t * 2.8 + 2.0));',
		'      swayDisp.x += s3 * w3;',
		'      swayDisp.y -= abs(s3) * 0.25 * w3;',
		'    }',
		'    // Tree 4 (left upper)',
		'    float yF4 = clamp((0.745 - p.y) / 0.140, 0.0, 1.0);',
		'    float hw4 = 0.052 * (1.15 - 0.65 * yF4);',
		'    float dx4 = abs(p.x - 0.205);',
		'    if (dx4 < hw4 && p.y > 0.59) {',
		'      float w4 = smoothstep(hw4, hw4 * 0.4, dx4) * smoothstep(0.58, 0.62, p.y);',
		'      float s4 = 0.0055 * pow(yF4, 1.5) * (sin(t * 1.5 + 2.1) + 0.35 * sin(t * 2.8 + 2.8));',
		'      swayDisp.x += s4 * w4;',
		'      swayDisp.y -= abs(s4) * 0.25 * w4;',
		'    }',
		'    // Tree 5 (in front of chalet)',
		'    float yF5 = clamp((0.810 - p.y) / 0.130, 0.0, 1.0);',
		'    float hw5 = 0.058 * (1.15 - 0.65 * yF5);',
		'    float dx5 = abs(p.x - 0.315);',
		'    if (dx5 < hw5 && p.y > 0.66) {',
		'      float w5 = smoothstep(hw5, hw5 * 0.4, dx5) * smoothstep(0.65, 0.69, p.y);',
		'      float s5 = 0.0060 * pow(yF5, 1.5) * (sin(t * 1.5 + 2.8) + 0.35 * sin(t * 2.8 + 3.5));',
		'      swayDisp.x += s5 * w5;',
		'      swayDisp.y -= abs(s5) * 0.25 * w5;',
		'    }',
		'  }',
		'',
		'  vec3 col = texture2D(uTex, p - swayDisp).rgb;',
		'',
		'  // 2. Drifting Mountain Valley Fog / Mist',
		'  float fogBand = smoothstep(0.26, 0.36, p.y) * (1.0 - smoothstep(0.48, 0.56, p.y));',
		'  if (fogBand > 0.001) {',
		'    float m1 = 0.5 + 0.5 * sin(p.x * 8.0 - t * 0.14 + sin(p.y * 12.0));',
		'    float m2 = 0.5 + 0.5 * cos(p.x * 14.0 + t * 0.18 + p.y * 8.0);',
		'    float m3 = 0.5 + 0.5 * sin((p.x - p.y) * 20.0 - t * 0.22);',
		'    float fogDensity = fogBand * (0.07 + 0.06 * m1 + 0.04 * m2 + 0.02 * m3);',
		'    vec3 fogCol = vec3(0.72, 0.78, 0.92);',
		'    col = mix(col, fogCol, fogDensity);',
		'  }',
		'',
		'  // 3. Glowing chalet windows & warm fireplace glimmer (masked to illuminated window panes)',
		'  vec2 chaletPos = vec2(0.45, 0.74);',
		'  float dChalet = length(p - chaletPos);',
		'  float isWindow = smoothstep(0.20, 0.45, col.r - col.b) * smoothstep(0.40, 0.75, col.r) * smoothstep(0.35, 0.05, dChalet);',
		'  float chaletFlicker = (0.18 + 0.10 * sin(t * 3.2) + 0.06 * sin(t * 5.6)) * isWindow;',
		'  col += vec3(1.0, 0.68, 0.18) * chaletFlicker;',
		'',
		'  // Twinkling village trail lights winding down the valley',
		'  float trailMask = smoothstep(0.18, 0.40, col.r - col.b) * smoothstep(0.58, 0.76, p.y) * smoothstep(0.50, 0.65, p.x);',
		'  float trailTwinkle = 0.14 * sin(t * 3.2 + p.x * 18.0 + p.y * 22.0) * trailMask;',
		'  col += vec3(0.30, 0.20, 0.05) * trailTwinkle;',
		'',
		'  // 4. Cars passing along visible sections of the mountain road',
		'  for (int i = 0; i < 3; i++) {',
		'    vec4 cData = uCars[i];',
		'    vec3 cProp = uCarProps[i];',
		'    float cActive = cProp.x;',
		'    if (cActive > 0.01) {',
		'      vec2 cPos = cData.xy;',
		'      vec2 cDir = cData.zw;',
		'      float isUphill = cProp.y;',
		'      float pScale = cProp.z;',
		'      vec2 toPixel = p - cPos;',
		'      float d = length(toPixel);',
		'      float dotFwd = dot(toPixel / (d + 1e-5), cDir);',
		'      float beamDist = 0.038 * pScale;',
		'',
		'      if (dotFwd > 0.35 && d < beamDist) {',
		'        float cone = pow(dotFwd, 3.0) * (1.0 - d / beamDist) * cActive;',
		'        col += vec3(0.65, 0.58, 0.35) * cone;',
		'      }',
		'',
		'      if (isUphill > 0.5) {',
		'        float tailGlow = exp(-d * d / (2.0 * pow(0.0035 * pScale, 2.0))) * cActive;',
		'        col += vec3(1.2, 0.15, 0.05) * tailGlow;',
		'      } else {',
		'        float headGlow = exp(-d * d / (2.0 * pow(0.0038 * pScale, 2.0))) * cActive;',
		'        col += vec3(1.1, 1.0, 0.75) * headGlow;',
		'        vec2 tailPos = cPos - cDir * 0.007 * pScale;',
		'        float dTail = length(p - tailPos);',
		'        float tailGlow = exp(-dTail * dTail / (2.0 * pow(0.0022 * pScale, 2.0))) * cActive;',
		'        col += vec3(0.9, 0.10, 0.05) * tailGlow;',
		'      }',
		'    }',
		'  }',
		'',
		'  // 5. Starry sky pinprick twinkle (strictly confined to open sky above mountain ridgelines)',
		'  float mountainLum = dot(col, vec3(0.299, 0.587, 0.114));',
		'  if (p.y < 0.060 && mountainLum < 0.18) {',
		'    float sG = sin(p.x * 160.0) * sin(p.y * 140.0 + 0.5);',
		'    if (sG > 0.88) {',
		'      float sTw = pow((sG - 0.88) / 0.12, 3.0) * (0.5 + 0.5 * sin(t * 2.5 + p.x * 45.0 + p.y * 65.0));',
		'      col += vec3(sTw * 0.35);',
		'    }',
		'  }',
		'',
		'  // Rich contrast & deep night-sky saturation',
		'  float sLuma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(sLuma), col, 1.18);',
		'  col = pow(max(vec3(0.0), col), vec3(1.04));',
		'',
		'  gl_FragColor = vec4(col, 1.0);',
		'}'
	].join('\n');

	var LIVE_FRAG_PEAKS = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uRes;',
		'uniform vec2 uImg;',
		'uniform float uTime;',
		'varying vec2 vUv;',
		'',
		'void main() {',
		'  float ca = uRes.x / uRes.y; float ia = uImg.x / uImg.y;',
		'  vec2 s = vec2(1.0);',
		'  if (ca > ia) { s.y = ia / ca; } else { s.x = ca / ia; }',
		'  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
		'  p = (p - 0.5) * s + 0.5;',
		'  vec3 col = texture2D(uTex, p).rgb;',
		'  gl_FragColor = vec4(col, 1.0);',
		'}'
	].join('\n');

	var LIVE_FRAG_OCEAN = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uRes;',
		'uniform vec2 uImg;',
		'uniform float uTime;',
		'varying vec2 vUv;',
		'',
		'float hash21(vec2 p) {',
		'  p = fract(p * vec2(123.34, 456.21));',
		'  p += dot(p, p + 45.32);',
		'  return fract(p.x * p.y);',
		'}',
		'',
		'float vnoise(vec2 p) {',
		'  vec2 i = floor(p);',
		'  vec2 f = fract(p);',
		'  vec2 u = f * f * (3.0 - 2.0 * f);',
		'  float a = hash21(i);',
		'  float b = hash21(i + vec2(1.0, 0.0));',
		'  float c = hash21(i + vec2(0.0, 1.0));',
		'  float d = hash21(i + vec2(1.0, 1.0));',
		'  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
		'}',
		'',
		'float cloudFbm(vec2 p) {',
		'  float f = 0.0;',
		'  f += 0.5000 * vnoise(p); p = p * 2.04;',
		'  f += 0.2500 * vnoise(p); p = p * 2.05;',
		'  f += 0.1250 * vnoise(p); p = p * 2.02;',
		'  f += 0.0625 * vnoise(p);',
		'  return f;',
		'}',
		'',
		'void main() {',
		'  float t = uTime;',
		'  float ca = uRes.x / uRes.y; float ia = uImg.x / uImg.y;',
		'  vec2 s = vec2(1.0);',
		'  if (ca > ia) { s.y = ia / ca; } else { s.x = ca / ia; }',
		'  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
		'  p = (p - 0.5) * s + 0.5;',
		'',
		'  // 1. Solid Pier & Gazebo Geometry Masking (stays 100% rock solid)',
		'  float distToPier = 1.0;',
		'  if (p.y > 0.46) {',
		'    float pierHalfW = 0.078 + 0.83 * (p.y - 0.46);',
		'    distToPier = abs(p.x - 0.50) - pierHalfW;',
		'  } else if (p.y > 0.38 && p.y <= 0.46) {',
		'    if (p.x > 0.31 && p.x < 0.69) {',
		'      distToPier = -1.0;',
		'    } else if (p.x <= 0.31) {',
		'      distToPier = 0.31 - p.x;',
		'    } else {',
		'      distToPier = p.x - 0.69;',
		'    }',
		'  }',
		'  float pierMargin = clamp(distToPier / 0.030, 0.0, 1.0);',
		'  float isWater = (p.y > 0.404) ? pierMargin : 0.0;',
		'',
		'  // 2. Natural Boat Floating Physics (smooth gentle bobbing)',
		'  // Boat 1 (foreground wooden rowboat on right)',
		'  vec2 d1 = p - vec2(0.853, 0.584);',
		'  float b1Rad = -0.33;',
		'  vec2 b1Rot = vec2(d1.x * cos(b1Rad) + d1.y * sin(b1Rad), -d1.x * sin(b1Rad) + d1.y * cos(b1Rad));',
		'  vec2 b1Coord = vec2(b1Rot.x / 0.17, b1Rot.y / 0.085);',
		'  float b1Dist = length(b1Coord);',
		'  float b1Mask = smoothstep(1.15, 0.72, b1Dist) * min(1.0, pierMargin * 1.5);',
		'  float b1Heave = sin(t * 1.6) * 0.0075;',
		'  float b1Pitch = cos(t * 1.4) * 0.0035;',
		'  float b1Roll  = sin(t * 1.6 + 0.6) * 0.0025;',
		'',
		'  // Distant vessels',
		'  vec2 d2 = p - vec2(0.054, 0.450);',
		'  float b2Mask = smoothstep(1.15, 0.70, length(vec2(d2.x / 0.065, d2.y / 0.025)));',
		'  float b2Heave = sin(t * 1.8 + 1.2) * 0.004;',
		'',
		'  vec2 d3 = p - vec2(0.893, 0.440);',
		'  float b3Mask = smoothstep(1.15, 0.70, length(vec2(d3.x / 0.065, d3.y / 0.025)));',
		'  float b3Heave = sin(t * 1.7 + 2.5) * 0.004;',
		'',
		'  float anyBoat = max(b1Mask, max(b2Mask, b3Mask));',
		'',
		'  // 3. Physically-Based Water Surface Waves & Normals',
		'  float wt = t * 1.5;',
		'  float depthFade = 0.35 + 0.65 * smoothstep(0.404, 0.85, p.y);',
		'  float waterWeight = isWater * (1.0 - anyBoat * 0.90) * depthFade;',
		'',
		'  // Three directional Gerstner-style wave trains:',
		'  // Wave 1: primary swell rolling gently towards pier (k1 = (18.0, 10.0))',
		'  float phase1 = p.x * 18.0 + p.y * 10.0 - wt * 1.5;',
		'  // Wave 2: secondary cross wave (k2 = (-14.0, 16.0))',
		'  float phase2 = -p.x * 14.0 + p.y * 16.0 + wt * 1.1;',
		'  // Wave 3: delicate capillary ripple (k3 = (28.0, -18.0))',
		'  float phase3 = p.x * 28.0 - p.y * 18.0 - wt * 2.1;',
		'',
		'  // Analytical surface gradient (dh/dx, dh/dy)',
		'  vec2 grad = vec2(0.0);',
		'  grad += vec2(18.0, 10.0) * cos(phase1) * 0.0040;',
		'  grad += vec2(-14.0, 16.0) * cos(phase2) * 0.0025;',
		'  grad += vec2(28.0, -18.0) * cos(phase3) * 0.0015;',
		'',
		'  // Surface normal vector N',
		'  vec3 N = normalize(vec3(-grad * waterWeight * 1.8, 1.0));',
		'',
		'  // 4. Optical Refraction (Snell\'s Law displacement of water image)',
		'  vec2 refractOffset = N.xy * 0.007 * waterWeight;',
		'',
		'  // Composite boat displacements',
		'  vec2 boatOffset = vec2(0.0);',
		'  boatOffset += vec2(b1Roll, b1Heave + b1Coord.x * b1Pitch) * b1Mask;',
		'  boatOffset += vec2(0.0, b2Heave) * b2Mask;',
		'  boatOffset += vec2(0.0, b3Heave) * b3Mask;',
		'',
		'  // Final sample coordinates: clean and stable',
		'  vec2 sampleCoord = p - refractOffset - boatOffset;',
		'  vec3 baseColor = texture2D(uTex, sampleCoord).rgb;',
		'',
		'  // 5. Floating Tropical Trade Wind Clouds across the Azure Sky',
		'  if (p.y < 0.38) {',
		'    float isGazebo = smoothstep(0.08, 0.0, abs(p.x - 0.50)) * smoothstep(0.33, 0.38, p.y) * (1.0 - smoothstep(0.30, 0.45, baseColor.b));',
		'    float skyMask = smoothstep(0.38, 0.34, p.y) * (1.0 - isGazebo);',
		'    if (skyMask > 0.01) {',
		'      vec3 azureSkyZenith = vec3(0.08, 0.76, 0.98);',
		'      vec3 azureSkyHorizon = vec3(0.55, 0.88, 0.98);',
		'      vec3 pureSky = mix(azureSkyZenith, azureSkyHorizon, smoothstep(0.0, 0.36, p.y));',
		'      float photoStaticCloud = smoothstep(0.35, 0.75, baseColor.r) * smoothstep(0.70, 0.95, baseColor.g);',
		'      baseColor = mix(baseColor, pureSky, photoStaticCloud * 0.75 * skyMask);',
		'',
		'      float altFactor = 0.65 + 0.35 * (1.0 - p.y / 0.38);',
		'      vec2 cUv1 = vec2((p.x - t * 0.022) * 2.5, (p.y * 4.5) / altFactor);',
		'      float c1 = cloudFbm(cUv1);',
		'      float cloud1 = smoothstep(0.46, 0.75, c1);',
		'',
		'      vec2 cUv2 = vec2((p.x - t * 0.036 + 4.2) * 4.0, (p.y * 7.0) / altFactor);',
		'      float c2 = cloudFbm(cUv2);',
		'      float cloud2 = smoothstep(0.48, 0.78, c2) * 0.65;',
		'',
		'      vec2 cUv3 = vec2((p.x - t * 0.016 + 8.7) * 1.8, (p.y * 3.2) / altFactor);',
		'      float c3 = cloudFbm(cUv3);',
		'      float cloud3 = smoothstep(0.52, 0.80, c3) * 0.50;',
		'',
		'      float cloudDensity = clamp(cloud1 + cloud2 + cloud3, 0.0, 1.0);',
		'      if (cloudDensity > 0.005) {',
		'        vec3 sunlitCloud = vec3(1.0, 0.99, 0.96);',
		'        vec3 shadowCloud = vec3(0.74, 0.86, 0.95);',
		'        float sunFacing = smoothstep(0.42, 0.72, c1);',
		'        vec3 cloudColor = mix(shadowCloud, sunlitCloud, sunFacing);',
		'        float cloudAlpha = cloudDensity * skyMask * 0.88;',
		'        baseColor = mix(baseColor, cloudColor, cloudAlpha);',
		'      }',
		'    }',
		'  }',
		'',
		'  // 6. Natural Water Optics (Fresnel, Specular Glints & Caustic Shimmer)',
		'  if (isWater > 0.02 && anyBoat < 0.8) {',
		'    // Viewer straight on (0, 0, 1)',
		'    vec3 V = vec3(0.0, 0.0, 1.0);',
		'    // Direction to tropical sun (overhead slightly right)',
		'    vec3 L = normalize(vec3(0.35, -0.65, 0.68));',
		'    vec3 H = normalize(L + V);',
		'',
		'    // Natural Blinn-Phong specular glints on wave crests',
		'    float NdotH = max(0.0, dot(N, H));',
		'    float specular = pow(NdotH, 75.0) * 0.40 * waterWeight;',
		'',
		'    // Gentle Fresnel reflection of soft tranquil sky',
		'    float fresnel = 0.02 + 0.16 * pow(1.0 - max(0.0, dot(N, V)), 3.0);',
		'    vec3 skyReflect = vec3(0.72, 0.88, 0.96);',
		'',
		'    // Organic, delicate caustic shimmer (smooth and subtle, not painted on)',
		'    float caustic = pow(0.5 + 0.5 * sin(phase1 + cos(phase2)), 4.0) * 0.09 * waterWeight;',
		'',
		'    // Blend optics naturally without washing out the photograph',
		'    baseColor = mix(baseColor, skyReflect, fresnel * waterWeight);',
		'    baseColor += vec3(0.08, 0.20, 0.22) * caustic + vec3(specular);',
		'  }',
		'',
		'  gl_FragColor = vec4(baseColor, 1.0);',
		'}'
	].join('\n');

	var LIVE_SHADERS = {
		sakura: LIVE_FRAG_SAKURA,
		volcano: LIVE_FRAG_VOLCANO,
		snowtown: LIVE_FRAG_SNOWTOWN,
		peaks: LIVE_FRAG_PEAKS,
		ocean: LIVE_FRAG_OCEAN
	};

	// --------------------------------------------------------------------------
	// SNOWTOWN MOUNTAIN ROAD SPLINE & CAR SIMULATION
	// --------------------------------------------------------------------------
	var SNOWTOWN_WAYPOINTS = [
		[0.530, 0.592],
		[0.575, 0.606],
		[0.625, 0.614],
		[0.585, 0.633],
		[0.645, 0.650],
		[0.720, 0.654],
		[0.805, 0.665],
		[0.865, 0.686],
		[0.825, 0.710],
		[0.755, 0.720],
		[0.820, 0.734],
		[0.900, 0.750],
		[0.960, 0.765]
	];
	var snowtownPieces = null;
	var snowtownRoadTotalLen = 0;
	function initSnowtownRoad() {
		if (snowtownPieces) return;
		var n = SNOWTOWN_WAYPOINTS.length;
		var segLens = [], segDirs = [], segAngs = [];
		for (var i = 0; i < n - 1; i++) {
			var dx = SNOWTOWN_WAYPOINTS[i+1][0] - SNOWTOWN_WAYPOINTS[i][0];
			var dy = SNOWTOWN_WAYPOINTS[i+1][1] - SNOWTOWN_WAYPOINTS[i][1];
			var l = Math.hypot(dx, dy);
			segLens.push(l);
			segDirs.push([dx / l, dy / l]);
			segAngs.push(Math.atan2(dy, dx));
		}

		// Corner fillet radius (proportional to segment length, capped to keep turns inside road)
		var cornerR = [];
		for (var i = 1; i < n - 1; i++) {
			var r = Math.min(segLens[i-1] * 0.44, segLens[i] * 0.44, 0.022);
			cornerR.push(r);
		}

		snowtownPieces = [];
		snowtownRoadTotalLen = 0;

		for (var i = 0; i < n - 1; i++) {
			var rStart = (i === 0) ? 0 : cornerR[i-1];
			var rEnd = (i === n - 2) ? 0 : cornerR[i];
			var straightLen = Math.max(0, segLens[i] - rStart - rEnd);
			var pStart = [
				SNOWTOWN_WAYPOINTS[i][0] + segDirs[i][0] * rStart,
				SNOWTOWN_WAYPOINTS[i][1] + segDirs[i][1] * rStart
			];
			var pEnd = [
				SNOWTOWN_WAYPOINTS[i+1][0] - segDirs[i][0] * rEnd,
				SNOWTOWN_WAYPOINTS[i+1][1] - segDirs[i][1] * rEnd
			];

			snowtownPieces.push({
				type: 0, // straight
				pStart: pStart,
				pEnd: pEnd,
				dir: segDirs[i],
				len: straightLen,
				startDist: snowtownRoadTotalLen,
				endDist: snowtownRoadTotalLen + straightLen
			});
			snowtownRoadTotalLen += straightLen;

			if (i < n - 2) {
				var r = cornerR[i];
				var wpC = SNOWTOWN_WAYPOINTS[i+1];
				var pA = [wpC[0] - segDirs[i][0] * r, wpC[1] - segDirs[i][1] * r];
				var pB = [wpC[0] + segDirs[i+1][0] * r, wpC[1] + segDirs[i+1][1] * r];
				var dAng = segAngs[i+1] - segAngs[i];
				while (dAng > Math.PI) dAng -= 2 * Math.PI;
				while (dAng < -Math.PI) dAng += 2 * Math.PI;

				// Numerically approximate quadratic Bezier arc length across turn
				var arcLen = 0;
				var prevPt = pA;
				for (var step = 1; step <= 12; step++) {
					var u = step / 12;
					var omt = 1 - u;
					var curX = omt * omt * pA[0] + 2 * omt * u * wpC[0] + u * u * pB[0];
					var curY = omt * omt * pA[1] + 2 * omt * u * wpC[1] + u * u * pB[1];
					arcLen += Math.hypot(curX - prevPt[0], curY - prevPt[1]);
					prevPt = [curX, curY];
				}

				snowtownPieces.push({
					type: 1, // filleted corner
					pA: pA,
					pB: pB,
					pC: wpC,
					angIn: segAngs[i],
					dAng: dAng,
					len: arcLen,
					startDist: snowtownRoadTotalLen,
					endDist: snowtownRoadTotalLen + arcLen
				});
				snowtownRoadTotalLen += arcLen;
			}
		}
	}
	function getSnowtownRoadPos(s) {
		initSnowtownRoad();
		s = Math.max(0, Math.min(1, s));
		var targetDist = s * snowtownRoadTotalLen;
		for (var i = 0; i < snowtownPieces.length; i++) {
			var piece = snowtownPieces[i];
			if (targetDist <= piece.endDist || i === snowtownPieces.length - 1) {
				var segLen = piece.len;
				var t = segLen > 1e-6 ? (targetDist - piece.startDist) / segLen : 0;
				t = Math.max(0, Math.min(1, t));

				if (piece.type === 0) {
					// Straight roadway section
					var x = piece.pStart[0] + (piece.pEnd[0] - piece.pStart[0]) * t;
					var y = piece.pStart[1] + (piece.pEnd[1] - piece.pStart[1]) * t;
					return [x, y, piece.dir[0], piece.dir[1]];
				} else {
					// Smoothly filleted corner turn
					var omt = 1 - t;
					var x = omt * omt * piece.pA[0] + 2 * omt * t * piece.pC[0] + t * t * piece.pB[0];
					var y = omt * omt * piece.pA[1] + 2 * omt * t * piece.pC[1] + t * t * piece.pB[1];
					// Smoothstep angular interpolation for continuous steering sweeps
					var st = t * t * (3 - 2 * t);
					var ang = piece.angIn + piece.dAng * st;
					return [x, y, Math.cos(ang), Math.sin(ang)];
				}
			}
		}
		var last = SNOWTOWN_WAYPOINTS[SNOWTOWN_WAYPOINTS.length - 1];
		return [last[0], last[1], 1, 0];
	}
	var snowtownCarData = new Float32Array(3 * 4);
	var snowtownCarProps = new Float32Array(3 * 3);
	function updateSnowtownCars(timeSec) {
		// Car 0: Downhill commuter from mountain pass (~10.4s duration, ~2x speed)
		var s0 = (timeSec * 0.096) % 1.0;
		var p0 = getSnowtownRoadPos(s0);
		snowtownCarData[0] = p0[0]; snowtownCarData[1] = p0[1];
		snowtownCarData[2] = p0[2]; snowtownCarData[3] = p0[3];
		var fade0 = Math.sin(s0 * Math.PI);
		snowtownCarProps[0] = fade0; snowtownCarProps[1] = 0.0; snowtownCarProps[2] = 0.5 + 1.2 * (p0[1] - 0.58) / 0.20;

		// Car 1: Uphill vehicle with red taillights (~12.5s duration, ~2x speed)
		var s1 = 1.0 - ((timeSec * 0.080 + 0.45) % 1.0);
		var p1 = getSnowtownRoadPos(s1);
		snowtownCarData[4] = p1[0]; snowtownCarData[5] = p1[1];
		snowtownCarData[6] = -p1[2]; snowtownCarData[7] = -p1[3];
		var fade1 = Math.sin(s1 * Math.PI);
		snowtownCarProps[3] = fade1; snowtownCarProps[4] = 1.0; snowtownCarProps[5] = 0.5 + 1.2 * (p1[1] - 0.58) / 0.20;

		// Car 2: Second downhill car (offset ~5.5s, ~2x speed)
		var s2 = ((timeSec + 5.5) * 0.092) % 1.0;
		var p2 = getSnowtownRoadPos(s2);
		snowtownCarData[8] = p2[0]; snowtownCarData[9] = p2[1];
		snowtownCarData[10] = p2[2]; snowtownCarData[11] = p2[3];
		var fade2 = Math.sin(s2 * Math.PI);
		snowtownCarProps[6] = fade2; snowtownCarProps[7] = 0.0; snowtownCarProps[8] = 0.5 + 1.2 * (p2[1] - 0.58) / 0.20;
	}

	// --------------------------------------------------------------------------
	// PEAKS ALPINE SKI SLOPES & DYNAMIC SKIER SIMULATION
	// --------------------------------------------------------------------------
	var PEAKS_WAYPOINTS_1 = [
		[0.640, 0.345],
		[0.570, 0.405],
		[0.630, 0.470],
		[0.535, 0.540],
		[0.590, 0.625],
		[0.510, 0.705],
		[0.440, 0.785]
	];
	var PEAKS_WAYPOINTS_2 = [
		[0.260, 0.375],
		[0.340, 0.435],
		[0.265, 0.505],
		[0.355, 0.590],
		[0.285, 0.675],
		[0.370, 0.760]
	];
	var peaksPisteDists1 = null;
	var peaksPisteLen1 = 0;
	var peaksPisteDists2 = null;
	var peaksPisteLen2 = 0;

	function initPeaksPistes() {
		if (peaksPisteDists1) return;
		peaksPisteDists1 = [0];
		peaksPisteLen1 = 0;
		for (var i = 0; i < PEAKS_WAYPOINTS_1.length - 1; i++) {
			var dx1 = PEAKS_WAYPOINTS_1[i+1][0] - PEAKS_WAYPOINTS_1[i][0];
			var dy1 = PEAKS_WAYPOINTS_1[i+1][1] - PEAKS_WAYPOINTS_1[i][1];
			peaksPisteLen1 += Math.sqrt(dx1*dx1 + dy1*dy1);
			peaksPisteDists1.push(peaksPisteLen1);
		}
		peaksPisteDists2 = [0];
		peaksPisteLen2 = 0;
		for (var j = 0; j < PEAKS_WAYPOINTS_2.length - 1; j++) {
			var dx2 = PEAKS_WAYPOINTS_2[j+1][0] - PEAKS_WAYPOINTS_2[j][0];
			var dy2 = PEAKS_WAYPOINTS_2[j+1][1] - PEAKS_WAYPOINTS_2[j][1];
			peaksPisteLen2 += Math.sqrt(dx2*dx2 + dy2*dy2);
			peaksPisteDists2.push(peaksPisteLen2);
		}
	}

	function getPeaksPistePos(pisteId, s) {
		initPeaksPistes();
		s = Math.max(0, Math.min(1, s));
		var wps = (pisteId === 1) ? PEAKS_WAYPOINTS_1 : PEAKS_WAYPOINTS_2;
		var dists = (pisteId === 1) ? peaksPisteDists1 : peaksPisteDists2;
		var totalLen = (pisteId === 1) ? peaksPisteLen1 : peaksPisteLen2;

		var targetDist = Math.max(0, Math.min(totalLen - 0.0001, s * totalLen));
		var posX = wps[0][0], posY = wps[0][1], dirX = 0, dirY = 1;
		for (var i = 0; i < dists.length - 1; i++) {
			if (targetDist >= dists[i] && targetDist <= dists[i+1]) {
				var segLen = dists[i+1] - dists[i];
				var t = segLen > 0 ? (targetDist - dists[i]) / segLen : 0;
				var wp0 = wps[i];
				var wp1 = wps[i+1];
				posX = wp0[0] + (wp1[0] - wp0[0]) * t;
				posY = wp0[1] + (wp1[1] - wp0[1]) * t;
				dirX = (wp1[0] - wp0[0]) / (segLen || 1);
				dirY = (wp1[1] - wp0[1]) / (segLen || 1);
				break;
			}
		}

		// Slalom carving turns across piste
		var carveTurns = (pisteId === 1) ? 14.0 : 11.0;
		var carvePhase = s * carveTurns * Math.PI * 2.0;
		var pScale = 0.65 + 0.65 * Math.max(0, Math.min(1, (posY - 0.35) / 0.45));
		var latAmp = 0.0085 * pScale;
		var nX = -dirY, nY = dirX;
		var latOffset = Math.sin(carvePhase) * latAmp;
		posX += nX * latOffset;
		posY += nY * latOffset;

		var dLat = Math.cos(carvePhase) * 0.70;
		var fwdX = dirX + nX * dLat;
		var fwdY = dirY + nY * dLat;
		var flen = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1.0;
		fwdX /= flen; fwdY /= flen;

		var carveFactor = -Math.sin(carvePhase);

		return [posX, posY, fwdX, fwdY, pScale, carveFactor];
	}

	var peaksSkierData = new Float32Array(3 * 4);
	var peaksSkierProps = new Float32Array(3 * 4);

	function updatePeaksSkiers(timeSec) {
		// Skier 0: Crimson Red Jacket on Piste 1 (Grand Couloir, ~18s run)
		var s0 = (timeSec * 0.055) % 1.0;
		var p0 = getPeaksPistePos(1, s0);
		peaksSkierData[0] = p0[0]; peaksSkierData[1] = p0[1];
		peaksSkierData[2] = p0[2]; peaksSkierData[3] = p0[3];
		var fade0 = Math.sin(s0 * Math.PI);
		peaksSkierProps[0] = fade0;
		peaksSkierProps[1] = 0.0;   // colorId 0 = Red
		peaksSkierProps[2] = p0[4]; // pScale
		peaksSkierProps[3] = p0[5]; // carveFactor

		// Skier 1: Electric Royal Blue Jacket on Piste 2 (West Face, ~21s run)
		var s1 = ((timeSec * 0.047 + 0.35) % 1.0);
		var p1 = getPeaksPistePos(2, s1);
		peaksSkierData[4] = p1[0]; peaksSkierData[5] = p1[1];
		peaksSkierData[6] = p1[2]; peaksSkierData[7] = p1[3];
		var fade1 = Math.sin(s1 * Math.PI);
		peaksSkierProps[4] = fade1;
		peaksSkierProps[5] = 1.0;   // colorId 1 = Blue
		peaksSkierProps[6] = p1[4];
		peaksSkierProps[7] = p1[5];

		// Skier 2: Neon Amber Jacket on Piste 1 (~18s run, trailing Skier 0 by ~9s)
		var s2 = ((timeSec * 0.055 + 0.52) % 1.0);
		var p2 = getPeaksPistePos(1, s2);
		peaksSkierData[8] = p2[0];  peaksSkierData[9] = p2[1];
		peaksSkierData[10] = p2[2]; peaksSkierData[11] = p2[3];
		var fade2 = Math.sin(s2 * Math.PI);
		peaksSkierProps[8] = fade2;
		peaksSkierProps[9] = 2.0;   // colorId 2 = Gold/Amber
		peaksSkierProps[10] = p2[4];
		peaksSkierProps[11] = p2[5];
	}

	function liveCompile(gl, type, src) {
		var sh = gl.createShader(type);
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			console.warn('[LiveBackdrop] shader compile failed:', gl.getShaderInfoLog(sh));
			gl.deleteShader(sh);
			return null;
		}
		return sh;
	}

	function liveGetProgram(scId) {
		if (live.programs[scId]) return live.programs[scId];
		var gl = live.gl;
		if (!gl) return null;
		var fsSource = LIVE_SHADERS[scId] || LIVE_SHADERS.sakura;
		var vs = liveCompile(gl, gl.VERTEX_SHADER, LIVE_VERT);
		var fs = liveCompile(gl, gl.FRAGMENT_SHADER, fsSource);
		if (!vs || !fs) return null;
		var prog = gl.createProgram();
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.bindAttribLocation(prog, 0, 'aPos');
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.warn('[LiveBackdrop] program link failed for ' + scId + ':', gl.getProgramInfoLog(prog));
			return null;
		}
		var pInfo = {
			prog: prog,
			uni: {
				tex: gl.getUniformLocation(prog, 'uTex'),
				res: gl.getUniformLocation(prog, 'uRes'),
				img: gl.getUniformLocation(prog, 'uImg'),
				time: gl.getUniformLocation(prog, 'uTime')
			}
		};
		if (scId === 'snowtown') {
			pInfo.uni.cars = gl.getUniformLocation(prog, 'uCars[0]') || gl.getUniformLocation(prog, 'uCars');
			pInfo.uni.carProps = gl.getUniformLocation(prog, 'uCarProps[0]') || gl.getUniformLocation(prog, 'uCarProps');
		} else if (scId === 'peaks') {
			pInfo.uni.skiers = gl.getUniformLocation(prog, 'uSkiers[0]') || gl.getUniformLocation(prog, 'uSkiers');
			pInfo.uni.skierProps = gl.getUniformLocation(prog, 'uSkierProps[0]') || gl.getUniformLocation(prog, 'uSkierProps');
		}
		live.programs[scId] = pInfo;
		return pInfo;
	}

	function liveInit() {
		if (live.supported !== null) return live.supported;
		live.supported = false;
		var container = document.getElementById('scenery-container');
		if (!container) return false;

		var canvas = document.createElement('canvas');
		canvas.id = 'scenery-live-canvas';
		canvas.className = 'scenery-live-canvas';
		var gl = null;
		try {
			var opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
			gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
		} catch (e) { gl = null; }
		if (!gl) return false;

		live.gl = gl;
		live.canvas = canvas;
		live.programs = {};
		var pInfo = liveGetProgram('sakura');
		if (!pInfo) return false;

		var buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		var aPos = gl.getAttribLocation(pInfo.prog, 'aPos');
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

		var tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		canvas.addEventListener('webglcontextlost', function (e) {
			e.preventDefault();
			live.texReady = false;
			live.supported = false;
			canvas.classList.remove('active');
		});

		var vignette = document.getElementById('scenery-vignette');
		container.insertBefore(canvas, vignette || null);

		live.canvas = canvas;
		live.gl = gl;
		live.buf = buf;
		live.tex = tex;
		live.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		live.supported = true;
		liveResize();
		return true;
	}

	function liveLoadTexture(scId) {
		if (!live.supported || live.texScene === scId) return;
		live.texScene = scId;
		live.texReady = false;
		var img = new Image();
		img.onload = function () {
			if (live.texScene !== scId || !live.gl) return;
			var gl = live.gl;
			gl.bindTexture(gl.TEXTURE_2D, live.tex);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
			live.imgW = img.naturalWidth || 768;
			live.imgH = img.naturalHeight || 1376;
			live.texReady = true;
			liveDraw(true);
			if (live.active && live.canvas) live.canvas.classList.add('active');
		};
		img.src = SCENERIES[scId].photo;
	}

	function liveResize() {
		if (!live.canvas) return;
		var cssW = window.innerWidth;
		var cssH = window.innerHeight;
		// On Android, 1.0 DPR matches the native 768x1376 resolution of the background art while saving 75% fragment shader load; iOS keeps 2.0 DPR
		var dpr = IS_ANDROID ? 1.0 : Math.min(window.devicePixelRatio || 1, 2.0);
		var w = Math.round(cssW * dpr);
		var h = Math.round(cssH * dpr);
		if (w !== live.width || h !== live.height) {
			live.width = w;
			live.height = h;
			live.canvas.width = w;
			live.canvas.height = h;
			if (live.gl) live.gl.viewport(0, 0, w, h);
			if (live.texReady) liveDraw(true);
		}
	}

	function liveDraw(force) {
		if (!live.gl || !live.texReady) return;
		var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		if (!force && IS_ANDROID && (now - live.lastDraw < 32)) return;
		live.lastDraw = now;
		var gl = live.gl;
		var pInfo = liveGetProgram(currentScenery);
		if (!pInfo) return;
		gl.useProgram(pInfo.prog);
		if (live.buf) {
			gl.bindBuffer(gl.ARRAY_BUFFER, live.buf);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		}

		var t = ((now - live.startTime) * 0.001) % 7200.0;
		gl.uniform2f(pInfo.uni.res, live.width, live.height);
		gl.uniform2f(pInfo.uni.img, live.imgW, live.imgH);
		gl.uniform1f(pInfo.uni.time, t);

		if (currentScenery === 'snowtown' && pInfo.uni.cars) {
			updateSnowtownCars(t);
			gl.uniform4fv(pInfo.uni.cars, snowtownCarData);
			gl.uniform3fv(pInfo.uni.carProps, snowtownCarProps);
		} else if (currentScenery === 'peaks' && pInfo.uni.skiers) {
			updatePeaksSkiers(t);
			gl.uniform4fv(pInfo.uni.skiers, peaksSkierData);
			gl.uniform4fv(pInfo.uni.skierProps, peaksSkierProps);
		}

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	function liveSetScene(scId) {
		var wantsLive = !!LIVE_SCENES[scId] && liveInit();
		if (wantsLive) {
			live.active = true;
			liveLoadTexture(scId);
			if (live.texReady && live.canvas) live.canvas.classList.add('active');
		} else if (live.canvas) {
			if (live.active) {
				// keep animating through the 1s cross-fade, then stop drawing
				live.fadeUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 1100;
			}
			live.active = false;
			live.canvas.classList.remove('active');
		}
	}

	function liveUpdate() {
		if (!live.canvas) return;
		var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		if (live.active || now < live.fadeUntil) liveDraw(false);
	}

	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('resize', function () {
			liveResize();
			peaks3DResize();
			if (typeof ocean3DResize === 'function') ocean3DResize();
			if (typeof volcano3DResize === 'function') volcano3DResize();
		});
		window.addEventListener('orientationchange', function () {
			setTimeout(function () {
				liveResize();
				peaks3DResize();
				if (typeof ocean3DResize === 'function') ocean3DResize();
				if (typeof volcano3DResize === 'function') volcano3DResize();
			}, 250);
		});
	}

	// --------------------------------------------------------------------------
	// REAL-TIME THREE.JS 3D ALPINE CHAIRLIFT OVER SEA OF CLOUDS (MOBILE PORTRAIT)
	// Inspired by High-Mountain Golden-Hour Vista Over a Sea of Valley Clouds:
	// - Framed specifically for 9:16 Mobile Portrait (with responsive frustum scaling)
	// - Saturated azure sky & warm golden afternoon sunlight
	// - Undulating, slowly drifting 3D Sea of Clouds filling the upper-mid valley
	// - Deep cobalt-shadowed left forested ridge & warm sunlit right powder bowl
	// - Diagonal 3D Quad Chairlift (bottom-left steel lattice tower to top-right sky)
	//   with 4 seated colorful 3D skiers ascending & empty chairs descending
	// --------------------------------------------------------------------------
	var peaks3D = {
		initialized: false,
		active: false,
		canvas: null,
		renderer: null,
		scene: null,
		camera: null,
		width: 0,
		height: 0,
		startTime: 0,
		liftGroup: null,
		upChairs: [],
		downChairs: [],
		sheaveWheels: [],
		cloudRows: [],
		trees: [],
		skiers: [],
		snowSystem: null
	};

	function peaksValleyHeightAt(x, z) {
		var depthProgress = Math.max(0, Math.min(1.2, (16.0 - z) / 62.0));
		var valleyFloor = 13.0 - depthProgress * 10.5;
		var leftShoulder = Math.max(0, (-x + 2.0) / 14.0);
		var leftRidge = Math.pow(leftShoulder, 1.25) * (9.5 - depthProgress * 2.5);
		var rightBowl = Math.max(0, (x - 0.5) / 14.0) * 3.8 + Math.exp(-Math.pow((x - 4.2) / 5.5, 2)) * 2.4;
		var undulation =
			Math.sin(x * 0.24 + z * 0.16) * 0.65 +
			Math.cos(x * 0.38 - z * 0.22) * 0.35;
		return valleyFloor + leftRidge + rightBowl + undulation;
	}

	var PORTRAIT_LIFT_CABLE = {
		x0: -6.2, y0: 3.4, z0: -28.0,
		x1: -3.85, y1: 9.85, z1: -15.5,
		x2: 2.35, y2: 27.6, z2: 10.5
	};

	function getPortraitLiftPoint(s, cableSide) {
		s = Math.max(0, Math.min(1, s));
		var c = PORTRAIT_LIFT_CABLE;
		var towerS = 0.32;
		var bx, by, bz, sag;

		if (s <= towerS) {
			var u0 = s / towerS;
			bx = c.x0 + (c.x1 - c.x0) * u0;
			by = c.y0 + (c.y1 - c.y0) * u0;
			bz = c.z0 + (c.z1 - c.z0) * u0;
			sag = Math.sin(u0 * Math.PI) * 0.28;
		} else {
			var u1 = (s - towerS) / (1.0 - towerS);
			bx = c.x1 + (c.x2 - c.x1) * u1;
			by = c.y1 + (c.y2 - c.y1) * u1;
			bz = c.z1 + (c.z2 - c.z1) * u1;
			sag = Math.sin(u1 * Math.PI) * 0.62;
		}

		var isDown = (cableSide > 0);
		var xOff = isDown ? 1.18 : 0.0;
		var yOff = isDown ? -0.92 : 0.0;
		var zOff = isDown ? -0.35 : 0.0;

		return {
			x: bx + xOff,
			y: by - sag + yOff,
			z: bz + zOff
		};
	}

	function createGoldenAlpineSkyTexture() {
		var c = document.createElement('canvas');
		c.width = 32;
		c.height = 256;
		var ctx = c.getContext('2d');
		var grad = ctx.createLinearGradient(0, 0, 0, 256);
		grad.addColorStop(0.00, '#1658c8');
		grad.addColorStop(0.22, '#2b7de9');
		grad.addColorStop(0.42, '#62aef9');
		grad.addColorStop(0.56, '#b8dfff');
		grad.addColorStop(0.68, '#ffe9c2');
		grad.addColorStop(1.00, '#ffdca3');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 32, 256);
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		return tex;
	}

	var sharedTreeGeoms = {};
	var sharedTreeVertexColorMat = null;

	function appendGeometryWithColor(geom, matrix, colorHex, outPos, outCol) {
		var posAttr = geom.getAttribute('position');
		var idxAttr = geom.getIndex();
		var c = new THREE.Color(colorHex);
		var v = new THREE.Vector3();
		if (idxAttr) {
			for (var i = 0; i < idxAttr.count; i++) {
				var vi = idxAttr.getX(i);
				v.fromBufferAttribute(posAttr, vi).applyMatrix4(matrix);
				outPos.push(v.x, v.y, v.z);
				outCol.push(c.r, c.g, c.b);
			}
		} else {
			for (var j = 0; j < posAttr.count; j++) {
				v.fromBufferAttribute(posAttr, j).applyMatrix4(matrix);
				outPos.push(v.x, v.y, v.z);
				outCol.push(c.r, c.g, c.b);
			}
		}
	}

	function getSharedTreeGeometry(isShadowSide, isGoldenAspen) {
		var key = isGoldenAspen ? 'aspen' : (isShadowSide ? 'shadow' : 'sun');
		if (sharedTreeGeoms[key]) return sharedTreeGeoms[key];

		var outPos = [];
		var outCol = [];
		var m = new THREE.Matrix4();

		var trunkGeom = new THREE.CylinderGeometry(0.09, 0.16, 0.75, 5);
		m.makeTranslation(0, 0.37, 0);
		appendGeometryWithColor(trunkGeom, m, 0x3d2817, outPos, outCol);

		if (isGoldenAspen) {
			var crownGeom = new THREE.ConeGeometry(0.62, 2.2, 6);
			m.makeTranslation(0, 1.45, 0);
			appendGeometryWithColor(crownGeom, m, 0xd9a05b, outPos, outCol);
		} else {
			var pineColor = isShadowSide ? 0x1a3352 : 0x1e4a38;
			var snowColor = isShadowSide ? 0x8fb3de : 0xfff5e4;
			var tiers = [
				{ r: 0.85, h: 1.25, y: 1.05 },
				{ r: 0.68, h: 1.10, y: 1.72 },
				{ r: 0.48, h: 0.95, y: 2.32 },
				{ r: 0.30, h: 0.75, y: 2.82 }
			];
			for (var i = 0; i < tiers.length; i++) {
				var t = tiers[i];
				var boughGeom = new THREE.ConeGeometry(t.r, t.h, 6);
				m.makeTranslation(0, t.y, 0);
				appendGeometryWithColor(boughGeom, m, pineColor, outPos, outCol);

				var frostGeom = new THREE.ConeGeometry(t.r * 0.93, t.h * 0.56, 6);
				var rotM = new THREE.Matrix4().makeRotationY(0.35);
				var transM = new THREE.Matrix4().makeTranslation(0, t.y + t.h * 0.22, 0);
				m.multiplyMatrices(transM, rotM);
				appendGeometryWithColor(frostGeom, m, snowColor, outPos, outCol);
			}
		}

		var merged = new THREE.BufferGeometry();
		merged.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
		merged.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
		merged.computeVertexNormals();
		sharedTreeGeoms[key] = merged;
		return merged;
	}

	function buildSnowyConiferTree(scale, isShadowSide, isGoldenAspen) {
		if (!sharedTreeVertexColorMat) {
			sharedTreeVertexColorMat = new THREE.MeshLambertMaterial({
				vertexColors: true,
				flatShading: true
			});
		}
		var s = scale || 1.0;
		var geom = getSharedTreeGeometry(isShadowSide, isGoldenAspen);
		var mesh = new THREE.Mesh(geom, sharedTreeVertexColorMat);
		mesh.scale.set(s, s, s);
		return mesh;
	}

	function buildQuadChairliftCarrier(hasPassengers, variantIdx) {
		var root = new THREE.Group();

		var galvSteelMat = new THREE.MeshStandardMaterial({
			color: 0xcbd5e1,
			roughness: 0.35,
			metalness: 0.72,
			flatShading: true
		});
		var darkSteelMat = new THREE.MeshStandardMaterial({
			color: 0x334155,
			roughness: 0.45,
			metalness: 0.6,
			flatShading: true
		});
		var seatPadMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, flatShading: true });

		// 1. Cable Grip & Roller Clamp Assembly at top (y = 0)
		var gripBody = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.38), galvSteelMat);
		root.add(gripBody);
		var gripWheelL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 8), darkSteelMat);
		gripWheelL.rotation.z = Math.PI / 2;
		gripWheelL.position.set(0, 0.05, -0.16);
		root.add(gripWheelL);
		var gripWheelR = gripWheelL.clone();
		gripWheelR.position.set(0, 0.05, 0.16);
		root.add(gripWheelR);

		// 2. Curved Gooseneck Hanger Arm
		var neckUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.88, 6), galvSteelMat);
		neckUpper.position.set(0, -0.44, 0);
		root.add(neckUpper);

		var neckCurve = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.07), galvSteelMat);
		neckCurve.position.set(0, -0.88, 0);
		root.add(neckCurve);

		// 3. Quad Chair Bail Frame (wide enough for 4 skiers side-by-side)
		var chairW = 1.92;
		var topBail = new THREE.Mesh(new THREE.BoxGeometry(chairW, 0.065, 0.065), galvSteelMat);
		topBail.position.set(0, -0.92, 0);
		root.add(topBail);

		var sideStrutGeom = new THREE.CylinderGeometry(0.032, 0.032, 1.05, 6);
		var strutL = new THREE.Mesh(sideStrutGeom, galvSteelMat);
		strutL.position.set(-chairW * 0.5, -1.44, 0);
		root.add(strutL);

		var strutR = new THREE.Mesh(sideStrutGeom, galvSteelMat);
		strutR.position.set(chairW * 0.5, -1.44, 0);
		root.add(strutR);

		// Safety bar & armrests
		var safetyBar = new THREE.Mesh(new THREE.BoxGeometry(chairW * 0.98, 0.04, 0.04), galvSteelMat);
		safetyBar.position.set(0, -1.08, 0.14);
		root.add(safetyBar);

		// Seat bench & slatted backrest
		var seatBench = new THREE.Mesh(new THREE.BoxGeometry(chairW * 0.96, 0.10, 0.44), seatPadMat);
		seatBench.position.set(0, -1.94, 0.10);
		root.add(seatBench);

		var backFrame = new THREE.Mesh(new THREE.BoxGeometry(chairW * 0.96, 0.42, 0.06), galvSteelMat);
		backFrame.position.set(0, -1.58, -0.10);
		root.add(backFrame);

		var seatUnderFrame = new THREE.Mesh(new THREE.BoxGeometry(chairW * 0.96, 0.06, 0.46), galvSteelMat);
		seatUnderFrame.position.set(0, -2.01, 0.10);
		root.add(seatUnderFrame);

		// 4. If Ascending Chair: Add 4 Seated Colorful 3D Skiers Side-by-Side (matching reference image!)
		if (hasPassengers) {
			var outfits = [
				{ jacket: 0x1b6ca8, pants: 0xb08942, helmet: 0x1e293b, goggles: 0x38bdf8, ski: 0xf43f5e, skiYaw: 0.06 },
				{ jacket: 0xe85d2a, pants: 0x1e293b, helmet: 0x1e293b, goggles: 0xfbbf24, ski: 0x6366f1, skiYaw: -0.18 },
				{ jacket: 0x6b2138, pants: 0x0f172a, helmet: 0x2563eb, goggles: 0xf472b6, ski: 0x0ea5e9, skiYaw: 0.22 },
				{ jacket: 0x283822, pants: 0xc26d2d, helmet: 0x1e293b, goggles: 0xf97316, ski: 0x10b981, skiYaw: -0.05 }
			];

			for (var p = 0; p < 4; p++) {
				var o = outfits[(p + (variantIdx || 0)) % outfits.length];
				var px = -0.66 + p * 0.44;
				var pGroup = new THREE.Group();
				pGroup.position.set(px, -1.90, 0.08);

				var jacketMat = new THREE.MeshLambertMaterial({ color: o.jacket, flatShading: true });
				var pantMat = new THREE.MeshLambertMaterial({ color: o.pants, flatShading: true });
				var helmetMat = new THREE.MeshLambertMaterial({ color: o.helmet, flatShading: true });
				var goggleMat = new THREE.MeshLambertMaterial({ color: o.goggles });
				var bootMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
				var skiMat = new THREE.MeshLambertMaterial({ color: o.ski });

				// Torso
				var torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.24), jacketMat);
				torso.position.set(0, 0.26, -0.02);
				pGroup.add(torso);

				// Outstretched wave arm on leftmost skier (matching reference photo!)
				if (p === 0) {
					var waveArm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.11), jacketMat);
					waveArm.position.set(-0.32, 0.42, 0.02);
					waveArm.rotation.z = 0.12;
					pGroup.add(waveArm);
				}

				// Seated thighs & dangling lower legs
				var thighL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.32), pantMat);
				thighL.position.set(-0.09, 0.04, 0.12);
				pGroup.add(thighL);
				var thighR = thighL.clone();
				thighR.position.set(0.09, 0.04, 0.12);
				pGroup.add(thighR);

				var shinL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.13), pantMat);
				shinL.position.set(-0.09, -0.18, 0.24);
				pGroup.add(shinL);
				var shinR = shinL.clone();
				shinR.position.set(0.09, -0.18, 0.24);
				pGroup.add(shinR);

				// Ski boots
				var bootL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.22), bootMat);
				bootL.position.set(-0.09, -0.38, 0.26);
				pGroup.add(bootL);
				var bootR = bootL.clone();
				bootR.position.set(0.09, -0.38, 0.26);
				pGroup.add(bootR);

				// Angled twin 3D skis attached to boots
				var skiGeom = new THREE.BoxGeometry(0.11, 0.035, 1.15);
				var skiL = new THREE.Mesh(skiGeom, skiMat);
				skiL.position.set(-0.10, -0.45, 0.30);
				skiL.rotation.x = 0.16;
				skiL.rotation.y = o.skiYaw;
				pGroup.add(skiL);

				var skiR = new THREE.Mesh(skiGeom, skiMat);
				skiR.position.set(0.10, -0.45, 0.30);
				skiR.rotation.x = 0.22;
				skiR.rotation.y = -o.skiYaw * 0.8;
				pGroup.add(skiR);

				// Helmet & bright ski goggles
				var helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 8), helmetMat);
				helmet.position.set(0, 0.60, 0.0);
				pGroup.add(helmet);

				var goggles = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.075, 0.10), goggleMat);
				goggles.position.set(0, 0.59, 0.11);
				pGroup.add(goggles);

				root.add(pGroup);
			}
		}

		return root;
	}

	function build3DLatticeLiftTower() {
		var towerGroup = new THREE.Group();
		var galvMat = new THREE.MeshStandardMaterial({
			color: 0xd8e2ef,
			roughness: 0.35,
			metalness: 0.72,
			flatShading: true
		});
		var darkWheelMat = new THREE.MeshStandardMaterial({
			color: 0x1e293b,
			roughness: 0.4,
			metalness: 0.6,
			flatShading: true
		});

		// 1. Tapered 4-Legged Steel Lattice Tower Mast (from y = 0 down to y = -6.2)
		var towerH = 6.2;
		var legOffsets = [
			[-1, -1], [1, -1], [-1, 1], [1, 1]
		];
		for (var l = 0; l < 4; l++) {
			var lx = legOffsets[l][0];
			var lz = legOffsets[l][1];
			var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, towerH, 6), galvMat);
			leg.position.set(lx * 0.28, -towerH * 0.5, lz * 0.24);
			leg.rotation.z = lx * 0.045;
			leg.rotation.x = -lz * 0.035;
			towerGroup.add(leg);
		}

		// Horizontal & diagonal X-bracing rungs along the lattice tower
		var levels = 8;
		for (var lv = 0; lv < levels; lv++) {
			var ly = -0.35 - lv * 0.72;
			var w = 0.44 + lv * 0.045;
			var rungF = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.04), galvMat);
			rungF.position.set(0, ly, 0.22);
			towerGroup.add(rungF);

			var rungB = rungF.clone();
			rungB.position.set(0, ly, -0.22);
			towerGroup.add(rungB);

			var diag = new THREE.Mesh(new THREE.BoxGeometry(w * 1.25, 0.035, 0.035), galvMat);
			diag.position.set(0, ly - 0.34, 0.22);
			diag.rotation.z = (lv % 2 === 0) ? 0.58 : -0.58;
			towerGroup.add(diag);
		}

		// Maintenance ladder on tower side
		var ladderRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, towerH, 0.18), galvMat);
		ladderRail.position.set(-0.36, -towerH * 0.5, 0);
		towerGroup.add(ladderRail);

		// 2. Top Cross-Arm Truss Bridge & Catwalk Railings
		var crossArmW = 2.65;
		var mainBeam = new THREE.Mesh(new THREE.BoxGeometry(crossArmW, 0.14, 0.26), galvMat);
		mainBeam.position.set(0.55, 0.0, 0);
		towerGroup.add(mainBeam);

		var upperTrussBar = new THREE.Mesh(new THREE.BoxGeometry(crossArmW * 0.92, 0.08, 0.18), galvMat);
		upperTrussBar.position.set(0.55, 0.48, 0);
		towerGroup.add(upperTrussBar);

		for (var st = -2; st <= 2; st++) {
			var post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.06), galvMat);
			post.position.set(0.55 + st * 0.52, 0.24, 0);
			towerGroup.add(post);
		}

		// 3. Multi-Wheel Sheave Assemblies (Left Uphill & Right Downhill Roller Trains)
		var sheaveWheels = [];
		var sides = [0.0, 1.18];
		for (var sIdx = 0; sIdx < sides.length; sIdx++) {
			var sx = sides[sIdx];
			var sy = (sIdx === 0) ? 0.0 : -0.88;
			var beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 1.65), galvMat);
			beam.position.set(sx, sy, 0);
			beam.rotation.x = -0.52;
			towerGroup.add(beam);

			for (var wIdx = -2; wIdx <= 2; wIdx++) {
				var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10), darkWheelMat);
				wheel.rotation.z = Math.PI / 2;
				wheel.position.set(sx, sy - wIdx * 0.15, wIdx * 0.26);
				towerGroup.add(wheel);
				sheaveWheels.push(wheel);
			}
		}

		towerGroup.userData.sheaveWheels = sheaveWheels;
		return towerGroup;
	}

	function peaks3DInit() {
		if (peaks3D.initialized) return true;
		if (typeof THREE === 'undefined') return false;
		var container = document.getElementById('scenery-container');
		if (!container) return false;

		try {
			var canvas = null;
			var renderer = null;
			if (!IS_ANDROID) {
				canvas = document.createElement('canvas');
				canvas.id = 'scenery-peaks-3d-canvas';
				canvas.className = 'scenery-peaks-3d-canvas';
				var vignette = document.getElementById('scenery-vignette');
				container.insertBefore(canvas, vignette || null);

				renderer = new THREE.WebGLRenderer({
					canvas: canvas,
					antialias: true,
					alpha: false,
					powerPreference: 'high-performance'
				});
				renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
				renderer.setClearColor(0x52a2f7, 1);
				renderer.outputEncoding = THREE.sRGBEncoding;
				if (typeof THREE.ACESFilmicToneMapping !== 'undefined') {
					renderer.toneMapping = THREE.ACESFilmicToneMapping;
					renderer.toneMappingExposure = 1.12;
				}
			}

			var scene = new THREE.Scene();
			scene.fog = new THREE.FogExp2(0xffe8c2, 0.0024);

			var camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 2.0, 420);

			peaks3D.canvas = canvas;
			peaks3D.renderer = renderer;
			peaks3D.scene = scene;
			peaks3D.camera = camera;
			peaks3D.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

			// 1. Saturated Golden-Hour Alpine Sky Dome
			var skyDome = new THREE.Mesh(
				new THREE.SphereGeometry(280, 24, 16),
				new THREE.MeshBasicMaterial({
					map: createGoldenAlpineSkyTexture(),
					side: THREE.BackSide,
					fog: false,
					depthWrite: false
				})
			);
			skyDome.position.set(0, 14, -40);
			scene.add(skyDome);

			// 2. Warm Golden-Hour Sunlight & Deep Cobalt Alpine Shadow Fill
			var hemiLight = new THREE.HemisphereLight(0xfff4dc, 0x2b4c7e, 0.88);
			scene.add(hemiLight);

			var dirSun = new THREE.DirectionalLight(0xffdf9e, 1.48);
			dirSun.position.set(48, 36, -15);
			scene.add(dirSun);

			var cobaltFill = new THREE.DirectionalLight(0x4f86d6, 0.52);
			cobaltFill.position.set(-42, 22, 18);
			scene.add(cobaltFill);

			// 3. Expansive 3D Sea of Valley Clouds (Batched to 1 Mesh per Row = 8 Draw Calls Total)
			peaks3D.cloudRows = [];
			var cloudPuffGeom = new THREE.IcosahedronGeometry(1.0, 2);
			var cloudDeckMat = new THREE.MeshLambertMaterial({
				color: 0xfff6e6,
				emissive: 0x3b4d70,
				emissiveIntensity: 0.25,
				flatShading: true,
				polygonOffset: true,
				polygonOffsetFactor: 2,
				polygonOffsetUnits: 2
			});
			var cloudRowVertexMat = new THREE.MeshLambertMaterial({
				vertexColors: true,
				emissive: 0x334566,
				emissiveIntensity: 0.24,
				flatShading: true
			});

			// Base cloud sea floor so there are no gaps in the cloud ocean
			var seaBase = new THREE.Mesh(
				new THREE.PlaneGeometry(240, 140, 28, 18),
				cloudDeckMat
			);
			seaBase.rotation.x = -Math.PI / 2;
			seaBase.position.set(0, 12.2, -102);
			scene.add(seaBase);

			var puffMatrix = new THREE.Matrix4();
			var puffPos = new THREE.Vector3();
			var puffQuat = new THREE.Quaternion();
			var puffScale = new THREE.Vector3();

			for (var row = 0; row < 8; row++) {
				var rz = -39.0 - row * 15.5;
				var ry = 13.0 + row * 0.22;
				var puffsInRow = 14 + (row % 3) * 2;
				var rowPosArr = [];
				var rowColArr = [];

				for (var cp = 0; cp < puffsInRow; cp++) {
					var cx = -56.0 + (cp / (puffsInRow - 1)) * 112.0 + Math.sin(row * 2.3 + cp) * 3.2;
					var cy = Math.cos(cp * 1.4 + row) * 0.45;
					var cz = Math.sin(cp * 1.9 - row) * 2.8;
					var radX = 5.5 + (cp % 3) * 1.8 + row * 0.35;
					var radY = 1.25 + (cp % 2) * 0.45;
					var radZ = 4.2 + (row % 2) * 1.4;

					puffPos.set(cx, cy, cz);
					puffScale.set(radX, radY, radZ);
					puffMatrix.compose(puffPos, puffQuat, puffScale);
					var pHex = ((cp + row) % 3 === 0) ? 0x9cb8e3 : 0xfff6e6;
					appendGeometryWithColor(cloudPuffGeom, puffMatrix, pHex, rowPosArr, rowColArr);
				}

				var rowMergedGeom = new THREE.BufferGeometry();
				rowMergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(rowPosArr, 3));
				rowMergedGeom.setAttribute('color', new THREE.Float32BufferAttribute(rowColArr, 3));
				rowMergedGeom.computeVertexNormals();

				var rowGroup = new THREE.Mesh(rowMergedGeom, cloudRowVertexMat);
				rowGroup.position.set(0, ry, rz);
				scene.add(rowGroup);
				peaks3D.cloudRows.push({
					group: rowGroup,
					baseY: ry,
					speed: (row % 2 === 0 ? 1 : -1) * (0.28 + (row % 3) * 0.12),
					phase: row * 1.1
				});
			}

			// Distant snow-capped horizon range barely peeking above the sea of clouds (top horizon)
			var horizonGeom = new THREE.PlaneGeometry(260, 18, 64, 4);
			var hPos = horizonGeom.getAttribute('position');
			for (var hi = 0; hi < hPos.count; hi++) {
				var hx = hPos.getX(hi);
				var hy = hPos.getY(hi);
				if (hy > 0) {
					var ridgeH = 1.8 + Math.sin(hx * 0.08) * 1.4 + Math.cos(hx * 0.19) * 0.9 + Math.abs(Math.sin(hx * 0.35)) * 1.1;
					hPos.setY(hi, ridgeH);
				}
			}
			horizonGeom.computeVertexNormals();
			var horizonMat = new THREE.MeshLambertMaterial({ color: 0xfff0d4, flatShading: true });
			var horizonMesh = new THREE.Mesh(horizonGeom, horizonMat);
			horizonMesh.position.set(0, 16.2, -168);
			scene.add(horizonMesh);

			// 4. Sculpted 3D Mountain Ridges & Sunlit Ski Bowl (Lower Half of Mobile Portrait)
			var valleyGeom = new THREE.PlaneGeometry(68, 60, 68, 56);
			valleyGeom.rotateX(-Math.PI / 2);
			var vPos = valleyGeom.getAttribute('position');
			var vCols = new Float32Array(vPos.count * 3);

			var colWarmSnow = new THREE.Color(0xfff3db);
			var colGoldenSlope = new THREE.Color(0xfce0b0);
			var colPeriwinkleTrack = new THREE.Color(0x6e92c9);
			var colDeepCobaltShadow = new THREE.Color(0x213a63);
			var tmpColor = new THREE.Color();

			for (var vi = 0; vi < vPos.count; vi++) {
				var vx = vPos.getX(vi);
				var vz = vPos.getZ(vi) - 14.0; // spans from z = +16 back to z = -44
				var vy = peaksValleyHeightAt(vx, vz);
				vPos.setXYZ(vi, vx, vy, vz);

				// Dramatic diagonal shadow boundary casting deep cobalt shadow across the left ridge
				// and warm golden afternoon snow light across the right slope (matching sample image!)
				var shadowBoundaryX = -1.2 + (vz + 20.0) * 0.14 + Math.sin(vz * 0.25) * 1.1;
				if (vx < shadowBoundaryX) {
					var sBlend = Math.min(1.0, (shadowBoundaryX - vx) / 4.5);
					tmpColor.copy(colPeriwinkleTrack).lerp(colDeepCobaltShadow, sBlend * 0.85);
				} else if (vz > 2.0 && vx < 1.8) {
					// Blue-shadowed groomer catwalk track at bottom-left foreground
					tmpColor.copy(colPeriwinkleTrack).lerp(colWarmSnow, 0.35);
				} else {
					var sunWave = 0.5 + 0.5 * Math.sin(vx * 0.32 + vz * 0.22);
					tmpColor.copy(colWarmSnow).lerp(colGoldenSlope, sunWave * 0.55);
				}

				vCols[vi * 3] = tmpColor.r;
				vCols[vi * 3 + 1] = tmpColor.g;
				vCols[vi * 3 + 2] = tmpColor.b;
			}
			valleyGeom.setAttribute('color', new THREE.BufferAttribute(vCols, 3));
			valleyGeom.computeVertexNormals();

			var valleyMesh = new THREE.Mesh(
				valleyGeom,
				new THREE.MeshStandardMaterial({
					vertexColors: true,
					roughness: 0.65,
					metalness: 0.04,
					flatShading: true
				})
			);
			scene.add(valleyMesh);

			// 5. Dense Snow-Frosted 3D Conifer Forest, Golden Aspens & Foreground Right Snow Pines
			// Background trees (tIdx < 95) are merged into 1 static forest mesh (1 draw call instead of 855!)
			// while foreground trees (tIdx >= 95) sway gently in the alpine breeze.
			peaks3D.trees = [];
			var forestPosArr = [];
			var forestColArr = [];
			var treeMat4 = new THREE.Matrix4();
			var treePosV = new THREE.Vector3();
			var treeQuat = new THREE.Quaternion();
			var treeEuler = new THREE.Euler();
			var treeScaleV = new THREE.Vector3();
			var tmpTreeV = new THREE.Vector3();

			for (var tIdx = 0; tIdx < 115; tIdx++) {
				var s1 = Math.sin(tIdx * 12.9898 + 0.7) * 43758.5453;
				var r1 = s1 - Math.floor(s1);
				var s2 = Math.sin(tIdx * 78.233 + 2.1) * 43758.5453;
				var r2 = s2 - Math.floor(s2);

				var tx, tz, tScale, isShadow, isAspen = false;
				if (tIdx < 62) {
					// Dense snow-frosted forest covering the shadowed left ridge & valley
					tx = -1.8 - r1 * 16.5;
					tz = 6.0 - r2 * 44.0;
					tScale = 0.58 + r1 * 0.45;
					isShadow = true;
					if (tIdx > 48 && tz > -16.0 && tx > -7.5) {
						isAspen = true; // Warm golden-tan aspen grove at the valley base
					}
				} else if (tIdx < 102) {
					// Scattered sunlit snow-frosted trees on the right ski slope glades
					tx = 0.5 + r1 * 15.5;
					tz = -4.0 - r2 * 34.0;
					tScale = 0.52 + r2 * 0.42;
					isShadow = false;
				} else {
					// Prominent heavily snow-frosted 3D conifers in the bottom-right foreground!
					tx = 1.6 + (tIdx - 102) * 0.85 + (r1 - 0.5) * 0.5;
					tz = 8.5 + (r2 - 0.5) * 3.8;
					tScale = 0.95 + (r1 * 0.55);
					isShadow = (tIdx % 2 === 0);
				}

				var ty = peaksValleyHeightAt(tx, tz) - 0.12;
				if (tIdx < 95) {
					var protoGeom = getSharedTreeGeometry(isShadow, isAspen);
					var pAttr = protoGeom.getAttribute('position');
					var cAttr = protoGeom.getAttribute('color');
					treePosV.set(tx, ty, tz);
					treeEuler.set(0, r2 * Math.PI * 2, 0);
					treeQuat.setFromEuler(treeEuler);
					treeScaleV.set(tScale, tScale, tScale);
					treeMat4.compose(treePosV, treeQuat, treeScaleV);
					for (var pvi = 0; pvi < pAttr.count; pvi++) {
						tmpTreeV.fromBufferAttribute(pAttr, pvi).applyMatrix4(treeMat4);
						forestPosArr.push(tmpTreeV.x, tmpTreeV.y, tmpTreeV.z);
						forestColArr.push(cAttr.getX(pvi), cAttr.getY(pvi), cAttr.getZ(pvi));
					}
				} else {
					var treeMesh = buildSnowyConiferTree(tScale, isShadow, isAspen);
					treeMesh.position.set(tx, ty, tz);
					treeMesh.rotation.y = r2 * Math.PI * 2;
					scene.add(treeMesh);

					peaks3D.trees.push({
						group: treeMesh,
						phase: tIdx * 0.7,
						speed: 1.3 + r1 * 0.7,
						amp: 0.025 + r2 * 0.02
					});
				}
			}

			if (forestPosArr.length > 0) {
				var staticForestGeom = new THREE.BufferGeometry();
				staticForestGeom.setAttribute('position', new THREE.Float32BufferAttribute(forestPosArr, 3));
				staticForestGeom.setAttribute('color', new THREE.Float32BufferAttribute(forestColArr, 3));
				staticForestGeom.computeVertexNormals();
				if (!sharedTreeVertexColorMat) {
					sharedTreeVertexColorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
				}
				scene.add(new THREE.Mesh(staticForestGeom, sharedTreeVertexColorMat));
			}

			// 6. Hero Moving 3D Element: Diagonal Quad Chairlift (Bottom-Left Tower to Top-Right Sky)
			var liftGroup = new THREE.Group();
			scene.add(liftGroup);
			peaks3D.liftGroup = liftGroup;

			// Foreground-Left 3D Galvanized Steel Lattice Tower
			var towerMesh = build3DLatticeLiftTower();
			towerMesh.position.set(
				PORTRAIT_LIFT_CABLE.x1,
				PORTRAIT_LIFT_CABLE.y1,
				PORTRAIT_LIFT_CABLE.z1
			);
			towerMesh.rotation.y = Math.atan2(
				PORTRAIT_LIFT_CABLE.x2 - PORTRAIT_LIFT_CABLE.x0,
				PORTRAIT_LIFT_CABLE.z2 - PORTRAIT_LIFT_CABLE.z0
			);
			liftGroup.add(towerMesh);
			peaks3D.sheaveWheels = towerMesh.userData.sheaveWheels || [];

			// Crisp Diagonal Uphill (Left) & Downhill (Right) Steel Haul Cables
			var cableMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
			for (var cSide = 0; cSide <= 1; cSide++) {
				var cPts = [];
				for (var cs = 0; cs <= 48; cs++) {
					var pt = getPortraitLiftPoint(cs / 48.0, cSide);
					cPts.push(new THREE.Vector3(pt.x, pt.y, pt.z));
				}
				var curve = new THREE.CatmullRomCurve3(cPts);
				var tubeGeom = new THREE.TubeGeometry(curve, 48, 0.026, 6, false);
				liftGroup.add(new THREE.Mesh(tubeGeom, cableMat));
			}

			// Ascending Quad Chairs (Left/Upper Cable) with 4 Seated Colorful 3D Skiers
			peaks3D.upChairs = [];
			var numUpChairs = 4;
			for (var uc = 0; uc < numUpChairs; uc++) {
				var upChairMesh = buildQuadChairliftCarrier(true, uc);
				liftGroup.add(upChairMesh);
				peaks3D.upChairs.push({
					mesh: upChairMesh,
					offset: uc / numUpChairs,
					swaySeed: uc * 1.9
				});
			}

			// Descending Empty Quad Chairs (Right/Lower Cable)
			peaks3D.downChairs = [];
			var numDownChairs = 4;
			for (var dc = 0; dc < numDownChairs; dc++) {
				var dnChairMesh = buildQuadChairliftCarrier(false, dc);
				liftGroup.add(dnChairMesh);
				peaks3D.downChairs.push({
					mesh: dnChairMesh,
					offset: (dc + 0.45) / numDownChairs,
					swaySeed: dc * 2.3 + 1.0
				});
			}

			// 7. Distant Graceful 3D Skiers Carving on the Sunlit Right Powder Bowl
			peaks3D.skiers = [];
			var skierColors = [0xe63946, 0x1d3557, 0xf77f00, 0x06d6a0];
			for (var skIdx = 0; skIdx < 4; skIdx++) {
				var skGroup = new THREE.Group();
				var skJacket = new THREE.Mesh(
					new THREE.BoxGeometry(0.24, 0.34, 0.18),
					new THREE.MeshLambertMaterial({ color: skierColors[skIdx] })
				);
				skJacket.position.y = 0.25;
				skGroup.add(skJacket);

				var skHead = new THREE.Mesh(
					new THREE.SphereGeometry(0.10, 6, 6),
					new THREE.MeshLambertMaterial({ color: 0x1e293b })
				);
				skHead.position.y = 0.48;
				skGroup.add(skHead);

				scene.add(skGroup);
				peaks3D.skiers.push({
					mesh: skGroup,
					progress: skIdx * 0.25,
					speed: 0.045 + (skIdx % 2) * 0.008,
					laneX: 2.8 + (skIdx % 2) * 2.4
				});
			}

			// 8. Subtle Glistening Golden-Hour Snow Motes in the Air
			var snowCount = 75;
			var snowGeom = new THREE.BufferGeometry();
			var snowPos = new Float32Array(snowCount * 3);
			for (var sn = 0; sn < snowCount; sn++) {
				snowPos[sn * 3] = (Math.random() - 0.5) * 28.0;
				snowPos[sn * 3 + 1] = 8.0 + Math.random() * 22.0;
				snowPos[sn * 3 + 2] = 14.0 - Math.random() * 42.0;
			}
			snowGeom.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
			var snowMat = new THREE.PointsMaterial({
				color: 0xfff8eb,
				size: 0.28,
				map: createParticleTexture('snow'),
				transparent: true,
				opacity: 0.65,
				depthWrite: false
			});
			var snowSystem = new THREE.Points(snowGeom, snowMat);
			scene.add(snowSystem);
			peaks3D.snowSystem = snowSystem;

			peaks3D.initialized = true;
			peaks3DResize();
			return true;
		} catch (err) {
			console.warn('[Peaks3D] Failed to initialize 3D Alpine Ski Scene:', err);
			return false;
		}
	}

	function peaks3DResize() {
		if (!peaks3D.initialized || !peaks3D.camera) return;
		var w = window.innerWidth || 390;
		var h = window.innerHeight || 844;
		if (w === peaks3D.width && h === peaks3D.height) return;
		peaks3D.width = w;
		peaks3D.height = h;
		if (peaks3D.renderer) {
			peaks3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
			peaks3D.renderer.setSize(w, h, false);
		}
		var aspect = w / h;
		peaks3D.camera.aspect = aspect;
		peaks3D.camera.fov = 48;
		peaks3D.camera.updateProjectionMatrix();

		// Scale horizontal X span of the diagonal chairlift proportionally if screen is wider than 9:16 portrait
		if (peaks3D.liftGroup) {
			var xScale = Math.max(0.95, Math.min(1.65, aspect / 0.52));
			peaks3D.liftGroup.scale.set(xScale, 1.0, 1.0);
		}
	}

	function peaks3DUpdate(dt, now) {
		if (!peaks3D.active || !peaks3D.initialized) return;
		dt = Math.min(dt || 0.016, 0.05);
		var t = ((now - peaks3D.startTime) * 0.001);

		// 1. Elevated High-Mountain Camera Looking Out Over the Sea of Clouds & Diagonal Chairlift
		var camX = Math.sin(t * 0.22) * 0.35;
		var camY = 24.0 + Math.cos(t * 0.18) * 0.25;
		var camZ = 22.0 + Math.sin(t * 0.15) * 0.35;
		peaks3D.camera.position.set(camX, camY, camZ);
		peaks3D.camera.lookAt(camX * 0.3, 14.5, -35.0);

		// 2. Spin Tower Sheave Wheels & Move Ascending/Descending 3D Quad Chairs Along Diagonal Cable
		for (var sw = 0; sw < peaks3D.sheaveWheels.length; sw++) {
			peaks3D.sheaveWheels[sw].rotation.x = t * 3.2;
		}

		var liftSpeed = 0.038;
		// Ascending 4-skier quad chairs (moving from bottom-left valley s=0 up to top-right camera s=1)
		for (var uc = 0; uc < peaks3D.upChairs.length; uc++) {
			var uChair = peaks3D.upChairs[uc];
			var sUp = (t * liftSpeed + uChair.offset) % 1.0;
			var ptUp = getPortraitLiftPoint(sUp, 0);
			uChair.mesh.position.set(ptUp.x, ptUp.y, ptUp.z);
			// Face skiers toward camera/valley vista as they ride up (matching reference photo!)
			uChair.mesh.rotation.y = -0.18 + Math.sin(t * 1.4 + uChair.swaySeed) * 0.04;
			uChair.mesh.rotation.z = Math.sin(t * 2.1 + uChair.swaySeed) * 0.045;
			uChair.mesh.rotation.x = Math.cos(t * 1.7 + uChair.swaySeed) * 0.03;
		}

		// Descending empty quad chairs (moving from top-right s=1 down to bottom-left s=0)
		for (var dc = 0; dc < peaks3D.downChairs.length; dc++) {
			var dChair = peaks3D.downChairs[dc];
			var sDn = 1.0 - ((t * liftSpeed + dChair.offset) % 1.0);
			var ptDn = getPortraitLiftPoint(sDn, 1);
			dChair.mesh.position.set(ptDn.x, ptDn.y, ptDn.z);
			dChair.mesh.rotation.y = -0.18 + Math.sin(t * 1.5 + dChair.swaySeed) * 0.04;
			dChair.mesh.rotation.z = Math.sin(t * 2.2 + dChair.swaySeed) * 0.04;
			dChair.mesh.rotation.x = Math.cos(t * 1.8 + dChair.swaySeed) * 0.025;
		}

		// 3. Undulate & Drift the 3D Sea of Valley Clouds
		for (var cr = 0; cr < peaks3D.cloudRows.length; cr++) {
			var rowObj = peaks3D.cloudRows[cr];
			rowObj.group.position.x = Math.sin(t * 0.12 + rowObj.phase) * 3.5;
			rowObj.group.position.y = rowObj.baseY + Math.cos(t * 0.45 + rowObj.phase) * 0.22;
		}

		// 4. Gentle Alpine Breeze in the Snow-Frosted 3D Conifer Trees
		for (var ti = 0; ti < peaks3D.trees.length; ti++) {
			var trObj = peaks3D.trees[ti];
			trObj.group.rotation.z = Math.sin(t * trObj.speed + trObj.phase) * trObj.amp;
		}

		// 5. Distant 3D Skiers Carving S-Turns Down the Sunlit Lower-Right Powder Slope
		for (var si = 0; si < peaks3D.skiers.length; si++) {
			var sk = peaks3D.skiers[si];
			sk.progress = (sk.progress + sk.speed * dt) % 1.0;
			var sz = -26.0 + sk.progress * 32.0;
			var sx = sk.laneX + Math.sin(sk.progress * Math.PI * 8.0 + si) * 1.35;
			var sy = peaksValleyHeightAt(sx, sz);
			sk.mesh.position.set(sx, sy, sz);
			sk.mesh.rotation.y = Math.cos(sk.progress * Math.PI * 8.0 + si) * 0.55;
			sk.mesh.rotation.z = -Math.sin(sk.progress * Math.PI * 8.0 + si) * 0.32;
		}

		// 6. Glistening Golden-Hour Snow Motes
		if (peaks3D.snowSystem) {
			var sPosAttr = peaks3D.snowSystem.geometry.getAttribute('position');
			var sArr = sPosAttr.array;
			for (var sn = 0; sn < sPosAttr.count; sn++) {
				var idx = sn * 3;
				sArr[idx] += Math.sin(t * 0.7 + sn) * 0.35 * dt;
				sArr[idx + 1] -= (0.65 + (sn % 4) * 0.18) * dt;
				if (sArr[idx + 1] < 8.0) {
					sArr[idx + 1] = 29.0;
				}
			}
			sPosAttr.needsUpdate = true;
		}

		if (peaks3D.renderer) {
			peaks3D.renderer.render(peaks3D.scene, peaks3D.camera);
		}
	}

	function renderBackgroundPass(targetRenderer) {
		if (!IS_ANDROID) return false;
		var r = targetRenderer || rendererRef;
		if (!r) return false;
		if (peaks3D.active && peaks3D.initialized && peaks3D.scene && peaks3D.camera) {
			r.autoClear = false;
			r.setClearColor(0x52a2f7, 1);
			r.clear(true, true, true);
			r.render(peaks3D.scene, peaks3D.camera);
			r.clearDepth();
			return true;
		}
		if (typeof ocean3D !== 'undefined' && ocean3D.active && ocean3D.initialized && ocean3D.scene && ocean3D.camera) {
			r.autoClear = false;
			r.setClearColor(0x0284c7, 1);
			r.clear(true, true, true);
			r.render(ocean3D.scene, ocean3D.camera);
			r.clearDepth();
			return true;
		}
		if (typeof volcano3D !== 'undefined' && volcano3D.active && volcano3D.initialized && volcano3D.scene && volcano3D.camera) {
			r.autoClear = false;
			r.setClearColor(0x060308, 1);
			r.clear(true, true, true);
			r.render(volcano3D.scene, volcano3D.camera);
			r.clearDepth();
			return true;
		}
		if (r.autoClear === false) {
			r.autoClear = true;
			r.setClearColor(0x000000, 0);
		}
		return false;
	}

	function peaks3DSetActive(isActive) {
		if (isActive) {
			if (peaks3DInit()) {
				peaks3D.active = true;
				peaks3DResize();
				if (peaks3D.canvas) peaks3D.canvas.classList.add('active');
				peaks3DUpdate(0.016, typeof performance !== 'undefined' ? performance.now() : Date.now());
			}
		} else {
			peaks3D.active = false;
			if (peaks3D.canvas) peaks3D.canvas.classList.remove('active');
		}
	}

	// --------------------------------------------------------------------------
	// REAL-TIME THREE.JS 3D TROPICAL PIER & LAGOON SCENE (PIGEON POINT TOBAGO)
	// Lightweight, High-Performance, True 3D Photorealistic Tropical Boardwalk:
	// - High-DPI Feathered Soft Natural Cumulus Cloud System (No Pixelated Artifacts)
	// - Full 3D Weathered Wooden Pier Boardwalk & Underwater Pilings
	// - Authentic Pitched Thatched Cabana / Gazebo (Pigeon Point) at the Pier End
	// - Physically-Based Tropical Water Shader (Gerstner Waves, Shallows Caustics, Specular Glints & Turquoise Palette)
	// - Authentic Bobbing Boats (Left Passenger Water Taxi & Right Speedboat)
	// - Soaring White Sea Terns / Seagulls in the Upper Azure Sky
	// --------------------------------------------------------------------------
	var ocean3D = {
		initialized: false,
		active: false,
		canvas: null,
		renderer: null,
		scene: null,
		camera: null,
		width: 0,
		height: 0,
		startTime: 0,
		waterMesh: null,
		waterMaterial: null,
		clouds: [],
		boat1: null,
		boat2: null,
		seagulls: []
	};

	function createTropicalSkyTexture() {
		var c = document.createElement('canvas');
		c.width = 64;
		c.height = 512;
		var ctx = c.getContext('2d');
		var grad = ctx.createLinearGradient(0, 0, 0, 512);
		grad.addColorStop(0.00, '#005ba6'); // Zenith deep Caribbean blue
		grad.addColorStop(0.18, '#0275d8'); // Radiant tropical azure
		grad.addColorStop(0.38, '#0ea5e9'); // Clear sky blue
		grad.addColorStop(0.58, '#38bdf8'); // Bright tropical cyan
		grad.addColorStop(0.78, '#7dd3fc'); // Soft trade wind sky
		grad.addColorStop(0.92, '#bae6fd'); // Sun-warmed light cyan
		grad.addColorStop(0.98, '#dff2fd'); // Horizon haze
		grad.addColorStop(1.00, '#bbf2f6'); // Aqua horizon sea line
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 64, 512);
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		return tex;
	}

	function createSoftCumulusCloudTexture(typeIndex) {
		var c = document.createElement('canvas');
		c.width = 512;
		c.height = 256;
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, 512, 256);

		function drawPuff(x, y, rx, ry, sunIntensity, shadowAmount) {
			ctx.save();
			ctx.translate(x, y);
			ctx.scale(rx, ry);
			var grad = ctx.createRadialGradient(0, -0.22, 0.05, 0, 0.12, 1.0);
			var topR = Math.round(255 * sunIntensity);
			var topG = Math.round(253 * sunIntensity);
			var topB = Math.round(248 * sunIntensity);
			var botR = Math.round(188 + (1 - shadowAmount) * 58);
			var botG = Math.round(210 + (1 - shadowAmount) * 42);
			var botB = Math.round(235 + (1 - shadowAmount) * 20);
			grad.addColorStop(0.0, 'rgba(' + topR + ',' + topG + ',' + topB + ', 0.88)');
			grad.addColorStop(0.42, 'rgba(' + topR + ',' + topG + ',' + topB + ', 0.72)');
			grad.addColorStop(0.74, 'rgba(' + botR + ',' + botG + ',' + botB + ', 0.36)');
			grad.addColorStop(1.0, 'rgba(' + botR + ',' + botG + ',' + botB + ', 0.0)');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(0, 0, 1.0, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		if (typeIndex === 0) {
			// Grand billowing tropical cumulus (center hero cloud)
			drawPuff(256, 175, 170, 48, 0.95, 0.45);
			drawPuff(180, 170, 120, 42, 0.92, 0.40);
			drawPuff(330, 172, 130, 44, 0.94, 0.42);
			drawPuff(220, 135, 105, 52, 0.98, 0.25);
			drawPuff(300, 130, 110, 55, 0.99, 0.22);
			drawPuff(145, 150, 85, 38, 0.92, 0.35);
			drawPuff(375, 148, 90, 40, 0.95, 0.32);
			drawPuff(255, 95, 92, 58, 1.0, 0.10);
			drawPuff(210, 108, 70, 48, 0.99, 0.12);
			drawPuff(295, 102, 75, 50, 1.0, 0.10);
		} else if (typeIndex === 1) {
			// Elongated trade wind cumulus (drifting flat base)
			drawPuff(256, 160, 210, 36, 0.94, 0.45);
			drawPuff(190, 140, 110, 42, 0.98, 0.28);
			drawPuff(310, 145, 120, 40, 0.96, 0.30);
			drawPuff(250, 115, 80, 45, 1.0, 0.12);
			drawPuff(130, 155, 80, 32, 0.92, 0.40);
			drawPuff(390, 155, 75, 30, 0.93, 0.38);
		} else if (typeIndex === 2) {
			// Delicate breezy trade wind cloudlet
			drawPuff(256, 150, 140, 38, 0.96, 0.35);
			drawPuff(210, 130, 80, 42, 0.99, 0.20);
			drawPuff(285, 135, 90, 40, 0.98, 0.22);
			drawPuff(150, 152, 65, 30, 0.92, 0.40);
			drawPuff(345, 150, 70, 32, 0.94, 0.38);
		} else {
			// Wispy high-altitude cirrus feather streak
			drawPuff(256, 140, 190, 22, 0.92, 0.20);
			drawPuff(180, 135, 130, 20, 0.94, 0.18);
			drawPuff(330, 142, 140, 21, 0.93, 0.19);
			drawPuff(260, 128, 90, 18, 0.96, 0.15);
		}

		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = true;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.magFilter = THREE.LinearFilter;
		return tex;
	}

	function buildTropicalWaterMaterial() {
		return new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uSunDir: { value: new THREE.Vector3(0.38, 0.82, -0.42).normalize() },
				uWaterColorShallow: { value: new THREE.Color(0x28decb) },
				uWaterColorMid: { value: new THREE.Color(0x0bb5cf) },
				uWaterColorDeep: { value: new THREE.Color(0x026aa0) },
				uSkyColor: { value: new THREE.Color(0xafe3fd) },
				uSunColor: { value: new THREE.Color(0xfffaea) }
			},
			vertexShader: [
				'uniform float uTime;',
				'varying vec3 vWorldPos;',
				'varying vec3 vNormal;',
				'varying vec2 vUv;',
				'',
				'vec3 gerstnerWave(vec2 dir, float steepness, float wavelength, float speed, vec3 p, inout vec3 tangent, inout vec3 binormal) {',
				'    float k = 2.0 * 3.14159265 / wavelength;',
				'    float c = sqrt(9.8 / k) * speed;',
				'    vec2 d = normalize(dir);',
				'    float f = k * (dot(d, p.xz) - c * uTime * 0.22);',
				'    float a = steepness / k;',
				'    tangent += vec3(-d.x * d.x * (steepness * sin(f)), d.x * (steepness * cos(f)), -d.x * d.y * (steepness * sin(f)));',
				'    binormal += vec3(-d.x * d.y * (steepness * sin(f)), d.y * (steepness * cos(f)), -d.y * d.y * (steepness * sin(f)));',
				'    return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));',
				'}',
				'',
				'void main() {',
				'    vUv = uv;',
				'    vec3 pos = position;',
				'    vec3 tangent = vec3(1.0, 0.0, 0.0);',
				'    vec3 binormal = vec3(0.0, 0.0, 1.0);',
				'    pos += gerstnerWave(vec2(0.12, -0.99), 0.14, 16.0, 1.05, position, tangent, binormal);',
				'    pos += gerstnerWave(vec2(-0.68, -0.73), 0.10, 9.2, 1.25, position, tangent, binormal);',
				'    pos += gerstnerWave(vec2(0.82, -0.57), 0.06, 4.6, 1.70, position, tangent, binormal);',
				'    vec3 norm = normalize(cross(binormal, tangent));',
				'    vNormal = normalMatrix * norm;',
				'    vec4 worldPos = modelMatrix * vec4(pos, 1.0);',
				'    vWorldPos = worldPos.xyz;',
				'    gl_Position = projectionMatrix * viewMatrix * worldPos;',
				'}'
			].join('\n'),
			fragmentShader: [
				'uniform float uTime;',
				'uniform vec3 uSunDir;',
				'uniform vec3 uWaterColorShallow;',
				'uniform vec3 uWaterColorMid;',
				'uniform vec3 uWaterColorDeep;',
				'uniform vec3 uSkyColor;',
				'uniform vec3 uSunColor;',
				'varying vec3 vWorldPos;',
				'varying vec3 vNormal;',
				'varying vec2 vUv;',
				'',
				'float causticWeb(vec2 p) {',
				'    vec2 p1 = p * 1.6 + vec2(uTime * 0.10, uTime * 0.07);',
				'    vec2 p2 = p * 2.1 - vec2(uTime * 0.08, -uTime * 0.11);',
				'    float c1 = sin(p1.x * 3.0 + cos(p1.y * 3.4)) * sin(p1.y * 2.8 + cos(p1.x * 3.1));',
				'    float c2 = cos(p2.x * 3.1 + sin(p2.y * 2.8)) * cos(p2.y * 3.3 + sin(p2.x * 2.6));',
				'    return pow(clamp((c1 + c2) * 0.5 + 0.5, 0.0, 1.0), 3.5);',
				'}',
				'',
				'void main() {',
				'    vec3 N = normalize(vNormal);',
				'    vec3 V = normalize(cameraPosition - vWorldPos);',
				'    vec3 L = normalize(uSunDir);',
				'    vec3 H = normalize(L + V);',
				'    float dist = length(vWorldPos.xz - vec2(0.0, 12.0));',
				'    float depthFactor = smoothstep(12.0, 115.0, dist);',
				'    vec3 waterColor = mix(uWaterColorShallow, uWaterColorMid, smoothstep(0.0, 0.45, depthFactor));',
				'    waterColor = mix(waterColor, uWaterColorDeep, smoothstep(0.40, 1.0, depthFactor));',
				'    if (vWorldPos.z > -48.0) {',
				'        float shallowMask = smoothstep(-48.0, 8.0, vWorldPos.z);',
				'        float caust = causticWeb(vWorldPos.xz * 0.45);',
				'        waterColor += vec3(0.55, 1.0, 0.95) * caust * 0.32 * shallowMask;',
				'    }',
				'    float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(N, V)), 4.0);',
				'    vec3 col = mix(waterColor, uSkyColor, fresnel * 0.68);',
				'    float NdotH = max(0.0, dot(N, H));',
				'    float spec = pow(NdotH, 85.0) * 1.15;',
				'    float microSpec = pow(NdotH, 28.0) * 0.25;',
				'    col += uSunColor * (spec + microSpec);',
				'    if (abs(vWorldPos.x) < 2.5 && vWorldPos.z > -36.0 && vWorldPos.z < 18.0) {',
				'        float distToPier = max(0.0, abs(vWorldPos.x) - 1.82);',
				'        float foam = smoothstep(0.50, 0.0, distToPier) * (sin(uTime * 2.8 + vWorldPos.z * 1.6) * 0.2 + 0.8);',
				'        col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.32);',
				'    }',
				'    gl_FragColor = vec4(col, 1.0);',
				'}'
			].join('\n'),
			side: THREE.DoubleSide
		});
	}

	function buildPierAndCabanaGeometries() {
		var pierPos = [];
		var pierCol = [];
		var thatchPos = [];
		var thatchCol = [];
		var m = new THREE.Matrix4();
		var rotM = new THREE.Matrix4();
		var transM = new THREE.Matrix4();

		var plankColors = [0xc8bcab, 0xbfb2a0, 0xb5a794, 0xccc1b0, 0xaaa08d, 0x9f917e];
		var beamColor = 0x5e4933;
		var pilingColor = 0x54422e;
		var pilingWetColor = 0x2b3831;
		var railColor = 0xa89984;

		// 1. PIER WALKWAY PLANKS (from Z = 16.0 down to Z = -18.0)
		var plankGeom = new THREE.BoxGeometry(3.60, 0.08, 0.28);
		var plankSpacing = 0.32;
		var zStart = 15.8;
		var zEnd = -18.0;
		var pCount = Math.floor((zStart - zEnd) / plankSpacing);

		for (var p = 0; p < pCount; p++) {
			var pz = zStart - p * plankSpacing;
			var py = 1.35 + ((p % 7 === 0) ? 0.008 : 0.0);
			m.makeTranslation(0, py, pz);
			var pCol = plankColors[p % plankColors.length];
			appendGeometryWithColor(plankGeom, m, pCol, pierPos, pierCol);
		}

		// Pier side kickboards / toe-rails
		var railLength = zStart - zEnd;
		var sideRailGeom = new THREE.BoxGeometry(0.12, 0.16, railLength);
		m.makeTranslation(-1.75, 1.44, (zStart + zEnd) * 0.5);
		appendGeometryWithColor(sideRailGeom, m, beamColor, pierPos, pierCol);
		m.makeTranslation(1.75, 1.44, (zStart + zEnd) * 0.5);
		appendGeometryWithColor(sideRailGeom, m, beamColor, pierPos, pierCol);

		// Substructure: longitudinal stringer beams under planks
		var stringerGeom = new THREE.BoxGeometry(0.18, 0.28, railLength);
		m.makeTranslation(-1.50, 1.20, (zStart + zEnd) * 0.5);
		appendGeometryWithColor(stringerGeom, m, beamColor, pierPos, pierCol);
		m.makeTranslation(1.50, 1.20, (zStart + zEnd) * 0.5);
		appendGeometryWithColor(stringerGeom, m, beamColor, pierPos, pierCol);

		// Crossbeams and round pilings every 2.8m along the pier
		var crossBeamGeom = new THREE.BoxGeometry(3.80, 0.24, 0.24);
		var pilingGeom = new THREE.CylinderGeometry(0.14, 0.14, 3.8, 8);
		var pilingWetGeom = new THREE.CylinderGeometry(0.145, 0.145, 1.2, 8);

		var bentsCount = Math.floor(railLength / 2.8);
		for (var b = 0; b <= bentsCount; b++) {
			var bz = zStart - b * 2.8;
			// Crossbeam
			m.makeTranslation(0, 1.05, bz);
			appendGeometryWithColor(crossBeamGeom, m, beamColor, pierPos, pierCol);

			// Left Piling
			m.makeTranslation(-1.55, -0.65, bz);
			appendGeometryWithColor(pilingGeom, m, pilingColor, pierPos, pierCol);
			// Left Wet waterline collar
			m.makeTranslation(-1.55, 0.15, bz);
			appendGeometryWithColor(pilingWetGeom, m, pilingWetColor, pierPos, pierCol);

			// Right Piling
			m.makeTranslation(1.55, -0.65, bz);
			appendGeometryWithColor(pilingGeom, m, pilingColor, pierPos, pierCol);
			// Right Wet waterline collar
			m.makeTranslation(1.55, 0.15, bz);
			appendGeometryWithColor(pilingWetGeom, m, pilingWetColor, pierPos, pierCol);
		}

		// Approach railings leading up to the gazebo (from Z = -12.0 to -18.0)
		var postGeom = new THREE.BoxGeometry(0.10, 1.10, 0.10);
		var topHandrailGeom = new THREE.BoxGeometry(0.12, 0.08, 6.2);
		var midHandrailGeom = new THREE.BoxGeometry(0.08, 0.06, 6.2);

		m.makeTranslation(-1.75, 2.38, -15.0);
		appendGeometryWithColor(topHandrailGeom, m, railColor, pierPos, pierCol);
		m.makeTranslation(-1.75, 1.90, -15.0);
		appendGeometryWithColor(midHandrailGeom, m, railColor, pierPos, pierCol);

		m.makeTranslation(1.75, 2.38, -15.0);
		appendGeometryWithColor(topHandrailGeom, m, railColor, pierPos, pierCol);
		m.makeTranslation(1.75, 1.90, -15.0);
		appendGeometryWithColor(midHandrailGeom, m, railColor, pierPos, pierCol);

		for (var rz = -12.0; rz >= -18.1; rz -= 1.5) {
			m.makeTranslation(-1.75, 1.90, rz);
			appendGeometryWithColor(postGeom, m, railColor, pierPos, pierCol);
			m.makeTranslation(1.75, 1.90, rz);
			appendGeometryWithColor(postGeom, m, railColor, pierPos, pierCol);
		}

		// 2. THE PIGEON POINT CABANA / GAZEBO PLATFORM & OPEN-AIR TIMBER FRAME
		// Platform deck extension (Z = -18.0 to -25.6, width 7.6m)
		var cabanaPlankGeom = new THREE.BoxGeometry(7.60, 0.10, 0.28);
		var cPlankCount = Math.floor(7.6 / plankSpacing);
		for (var cp = 0; cp < cPlankCount; cp++) {
			var cpz = -18.0 - cp * plankSpacing;
			m.makeTranslation(0, 1.35, cpz);
			appendGeometryWithColor(cabanaPlankGeom, m, plankColors[(cp + 3) % plankColors.length], pierPos, pierCol);
		}

		// 6 Sturdy Timber Roof Support Pillars (rises from deck Y=1.35 to tie-beam Y=6.20)
		var pillarGeom = new THREE.BoxGeometry(0.26, 4.85, 0.26);
		var pillarWetGeom = new THREE.CylinderGeometry(0.20, 0.20, 1.4, 8);
		var pillarSubGeom = new THREE.CylinderGeometry(0.18, 0.18, 3.8, 8);
		var pillarZs = [-18.6, -22.0, -25.4];

		for (var pi = 0; pi < pillarZs.length; pi++) {
			var pzPos = pillarZs[pi];
			// Left post (above deck)
			m.makeTranslation(-3.40, 3.77, pzPos);
			appendGeometryWithColor(pillarGeom, m, beamColor, pierPos, pierCol);
			// Left piling (under deck into water)
			m.makeTranslation(-3.40, -0.65, pzPos);
			appendGeometryWithColor(pillarSubGeom, m, pilingColor, pierPos, pierCol);
			m.makeTranslation(-3.40, 0.15, pzPos);
			appendGeometryWithColor(pillarWetGeom, m, pilingWetColor, pierPos, pierCol);

			// Right post (above deck)
			m.makeTranslation(3.40, 3.77, pzPos);
			appendGeometryWithColor(pillarGeom, m, beamColor, pierPos, pierCol);
			// Right piling (under deck into water)
			m.makeTranslation(3.40, -0.65, pzPos);
			appendGeometryWithColor(pillarSubGeom, m, pilingColor, pierPos, pierCol);
			m.makeTranslation(3.40, 0.15, pzPos);
			appendGeometryWithColor(pillarWetGeom, m, pilingWetColor, pierPos, pierCol);
		}

		// Front, Mid & Rear Open-Air A-Frame Trusses (Tobago Pigeon Point style)
		var trussZs = [-18.6, -22.0, -25.4];
		var tieBeamGeom = new THREE.BoxGeometry(7.20, 0.20, 0.20);
		var rafterGeom = new THREE.BoxGeometry(0.18, 7.30, 0.18);
		var kingPostGeom = new THREE.BoxGeometry(0.20, 6.40, 0.20);
		var strutGeom = new THREE.BoxGeometry(0.14, 3.20, 0.14);

		for (var ti = 0; ti < trussZs.length; ti++) {
			var tz = trussZs[ti];
			// Horizontal tie-beam at Y = 6.20
			m.makeTranslation(0, 6.20, tz);
			appendGeometryWithColor(tieBeamGeom, m, beamColor, pierPos, pierCol);

			// Center vertical king post from Y = 6.20 to 12.60
			m.makeTranslation(0, 9.40, tz);
			appendGeometryWithColor(kingPostGeom, m, beamColor, pierPos, pierCol);

			// Left angled rafter
			rotM.makeRotationZ(-0.50);
			transM.makeTranslation(-1.75, 9.40, tz);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(rafterGeom, m, beamColor, pierPos, pierCol);

			// Right angled rafter
			rotM.makeRotationZ(0.50);
			transM.makeTranslation(1.75, 9.40, tz);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(rafterGeom, m, beamColor, pierPos, pierCol);

			// Left diagonal strut brace
			rotM.makeRotationZ(0.50);
			transM.makeTranslation(-1.60, 7.40, tz);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(strutGeom, m, beamColor, pierPos, pierCol);

			// Right diagonal strut brace
			rotM.makeRotationZ(-0.50);
			transM.makeTranslation(1.60, 7.40, tz);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(strutGeom, m, beamColor, pierPos, pierCol);
		}

		// Longitudinal Ridge Beam & Side Eave Purlins
		var ridgeBeamGeom = new THREE.BoxGeometry(0.22, 0.22, 7.60);
		m.makeTranslation(0, 12.60, -22.0);
		appendGeometryWithColor(ridgeBeamGeom, m, beamColor, pierPos, pierCol);

		var eavePurlinGeom = new THREE.BoxGeometry(0.20, 0.20, 7.60);
		m.makeTranslation(-3.45, 6.20, -22.0);
		appendGeometryWithColor(eavePurlinGeom, m, beamColor, pierPos, pierCol);
		m.makeTranslation(3.45, 6.20, -22.0);
		appendGeometryWithColor(eavePurlinGeom, m, beamColor, pierPos, pierCol);

		// Built-in wooden bench seats inside the shelter (left & right)
		var benchSeatGeom = new THREE.BoxGeometry(0.52, 0.08, 6.20);
		var benchLegGeom = new THREE.BoxGeometry(0.12, 0.50, 0.12);
		var benchBackGeom = new THREE.BoxGeometry(0.08, 0.40, 6.20);

		// Left bench
		m.makeTranslation(-2.95, 1.85, -22.0);
		appendGeometryWithColor(benchSeatGeom, m, 0x8a6e4d, pierPos, pierCol);
		m.makeTranslation(-3.25, 2.15, -22.0);
		appendGeometryWithColor(benchBackGeom, m, 0x8a6e4d, pierPos, pierCol);
		m.makeTranslation(-2.95, 1.60, -19.5);
		appendGeometryWithColor(benchLegGeom, m, beamColor, pierPos, pierCol);
		m.makeTranslation(-2.95, 1.60, -24.5);
		appendGeometryWithColor(benchLegGeom, m, beamColor, pierPos, pierCol);

		// Right bench
		m.makeTranslation(2.95, 1.85, -22.0);
		appendGeometryWithColor(benchSeatGeom, m, 0x8a6e4d, pierPos, pierCol);
		m.makeTranslation(3.25, 2.15, -22.0);
		appendGeometryWithColor(benchBackGeom, m, 0x8a6e4d, pierPos, pierCol);
		m.makeTranslation(2.95, 1.60, -19.5);
		appendGeometryWithColor(benchLegGeom, m, beamColor, pierPos, pierCol);
		m.makeTranslation(2.95, 1.60, -24.5);
		appendGeometryWithColor(benchLegGeom, m, beamColor, pierPos, pierCol);

		// Nautical Signs from Reference Image!
		// Right Post: Circular Speed / Warning Sign (white face with red border)
		var signDiscGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16);
		rotM.makeRotationX(Math.PI / 2);
		transM.makeTranslation(3.55, 6.50, -18.45);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(signDiscGeom, m, 0xffffff, pierPos, pierCol);

		var signRimGeom = new THREE.CylinderGeometry(0.38, 0.38, 0.03, 16);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(signRimGeom, m, 0xd92626, pierPos, pierCol);

		// Left Post: Rectangular Notice Board (white board with green top)
		var noticeGeom = new THREE.BoxGeometry(0.55, 0.38, 0.04);
		m.makeTranslation(-3.55, 6.70, -18.45);
		appendGeometryWithColor(noticeGeom, m, 0xffffff, pierPos, pierCol);
		var noticeHeaderGeom = new THREE.BoxGeometry(0.55, 0.10, 0.045);
		m.makeTranslation(-3.55, 6.85, -18.45);
		appendGeometryWithColor(noticeHeaderGeom, m, 0x1f8a4c, pierPos, pierCol);

		// Pier End Lower Landing Platform (beyond cabana at Z = -25.6 to -28.0)
		var endPlankGeom = new THREE.BoxGeometry(4.20, 0.08, 0.28);
		for (var ep = 0; ep < 8; ep++) {
			var epz = -25.6 - ep * plankSpacing;
			m.makeTranslation(0, 1.35, epz);
			appendGeometryWithColor(endPlankGeom, m, plankColors[(ep + 2) % plankColors.length], pierPos, pierCol);
		}
		// End Mooring Posts & Ladder Pilings
		var mooringPostGeom = new THREE.CylinderGeometry(0.18, 0.18, 4.4, 8);
		m.makeTranslation(-1.95, -0.65, -27.8);
		appendGeometryWithColor(mooringPostGeom, m, 0x4a3b2b, pierPos, pierCol);
		m.makeTranslation(1.95, -0.65, -27.8);
		appendGeometryWithColor(mooringPostGeom, m, 0x4a3b2b, pierPos, pierCol);

		// 3. AUTHENTIC PITCHED THATCHED PALM-FROND ROOF
		var thatchColorDark = 0x8b6531;
		var thatchColorMid = 0xa88448;
		var thatchColorLight = 0xc29f5d;
		var thatchColorWarm = 0xb89250;

		// 3 Tiered overlapping thatch layers for rich natural depth & overhanging eaves
		var tiersData = [
			// Base tier (thick fringed thatch layer)
			{ thickness: 0.36, length: 7.80, depth: 8.20, xL: -1.85, xR: 1.85, y: 9.50, col: thatchColorDark },
			// Mid tier (overlapping mid layer)
			{ thickness: 0.30, length: 7.50, depth: 7.80, xL: -1.82, xR: 1.82, y: 9.55, col: thatchColorMid },
			// Top tier (golden crown near ridge)
			{ thickness: 0.24, length: 7.20, depth: 7.40, xL: -1.80, xR: 1.80, y: 9.60, col: thatchColorWarm }
		];

		for (var ti = 0; ti < tiersData.length; ti++) {
			var td = tiersData[ti];
			var tierGeom = new THREE.BoxGeometry(td.thickness, td.length, td.depth);

			// Left roof slope
			rotM.makeRotationZ(-0.50);
			transM.makeTranslation(td.xL, td.y, -22.0);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(tierGeom, m, td.col, thatchPos, thatchCol);

			// Right roof slope
			rotM.makeRotationZ(0.50);
			transM.makeTranslation(td.xR, td.y, -22.0);
			m.multiplyMatrices(transM, rotM);
			appendGeometryWithColor(tierGeom, m, td.col, thatchPos, thatchCol);
		}

		// Distinct Thick Overhanging Eave Fringe along the left and right gutters!
		var fringeGeom = new THREE.BoxGeometry(0.38, 0.22, 0.42);
		for (var fz = -25.6; fz <= -18.4; fz += 0.40) {
			// Left eave fringe
			m.makeTranslation(-3.85, 6.10, fz);
			appendGeometryWithColor(fringeGeom, m, ((Math.round(fz * 10) % 2 === 0) ? thatchColorDark : thatchColorWarm), thatchPos, thatchCol);
			// Right eave fringe
			m.makeTranslation(3.85, 6.10, fz);
			appendGeometryWithColor(fringeGeom, m, ((Math.round(fz * 10) % 2 === 0) ? thatchColorDark : thatchColorWarm), thatchPos, thatchCol);
		}

		// Woven Thatched Ridge Cap along top gable peak
		var ridgeCapGeom = new THREE.CylinderGeometry(0.28, 0.28, 8.00, 8);
		rotM.makeRotationX(Math.PI / 2);
		transM.makeTranslation(0, 12.75, -22.0);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(ridgeCapGeom, m, thatchColorWarm, thatchPos, thatchCol);

		// MERGE BOTH BUFFER GEOMETRIES
		var pierMergedGeom = new THREE.BufferGeometry();
		pierMergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(pierPos, 3));
		pierMergedGeom.setAttribute('color', new THREE.Float32BufferAttribute(pierCol, 3));
		pierMergedGeom.computeVertexNormals();

		var thatchMergedGeom = new THREE.BufferGeometry();
		thatchMergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(thatchPos, 3));
		thatchMergedGeom.setAttribute('color', new THREE.Float32BufferAttribute(thatchCol, 3));
		thatchMergedGeom.computeVertexNormals();

		return {
			pierGeom: pierMergedGeom,
			thatchGeom: thatchMergedGeom
		};
	}

	function buildBoat1PassengerTaxi() {
		// Boat 1 (Left): Tropical Passenger Water Taxi (White hull, orange-red gunwale & canopy)
		var boatGroup = new THREE.Group();
		var boatPos = [];
		var boatCol = [];
		var m = new THREE.Matrix4();
		var rotM = new THREE.Matrix4();
		var transM = new THREE.Matrix4();

		// Main Hull
		var hullGeom = new THREE.BoxGeometry(1.80, 0.85, 4.80);
		m.makeTranslation(0, 0.15, 0);
		appendGeometryWithColor(hullGeom, m, 0xffffff, boatPos, boatCol);

		// Pointed Bow
		var bowGeom = new THREE.ConeGeometry(0.90, 1.40, 4);
		rotM.makeRotationX(-Math.PI / 2);
		transM.makeTranslation(0, 0.15, -2.90);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(bowGeom, m, 0xffffff, boatPos, boatCol);

		// Vibrant Orange-Red Upper Gunwale Trim (matching photo!)
		var gunwaleColor = 0xe84a20;
		var gunwaleGeom = new THREE.BoxGeometry(1.92, 0.16, 4.85);
		m.makeTranslation(0, 0.60, 0);
		appendGeometryWithColor(gunwaleGeom, m, gunwaleColor, boatPos, boatCol);

		// Passenger Canopy Support Posts
		var postGeom = new THREE.BoxGeometry(0.08, 0.95, 0.08);
		var postXs = [-0.85, 0.85];
		var postZs = [-1.6, -0.5, 0.6, 1.7];
		for (var px = 0; px < postXs.length; px++) {
			for (var pz = 0; pz < postZs.length; pz++) {
				m.makeTranslation(postXs[px], 1.10, postZs[pz]);
				appendGeometryWithColor(postGeom, m, 0xffffff, boatPos, boatCol);
			}
		}

		// Orange Canopy Roof
		var canopyGeom = new THREE.BoxGeometry(1.95, 0.12, 3.80);
		m.makeTranslation(0, 1.62, 0.10);
		appendGeometryWithColor(canopyGeom, m, gunwaleColor, boatPos, boatCol);

		// Passenger Benches
		var benchGeom = new THREE.BoxGeometry(1.60, 0.08, 0.32);
		m.makeTranslation(0, 0.40, -1.0);
		appendGeometryWithColor(benchGeom, m, 0x5e4933, boatPos, boatCol);
		m.makeTranslation(0, 0.40, 0.1);
		appendGeometryWithColor(benchGeom, m, 0x5e4933, boatPos, boatCol);
		m.makeTranslation(0, 0.40, 1.2);
		appendGeometryWithColor(benchGeom, m, 0x5e4933, boatPos, boatCol);

		var mergedGeom = new THREE.BufferGeometry();
		mergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(boatPos, 3));
		mergedGeom.setAttribute('color', new THREE.Float32BufferAttribute(boatCol, 3));
		mergedGeom.computeVertexNormals();

		var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
		var mesh = new THREE.Mesh(mergedGeom, mat);
		boatGroup.add(mesh);

		// Yellow Mooring Rope
		var ropeGeom = new THREE.CylinderGeometry(0.03, 0.03, 7.5, 4);
		var ropeMat = new THREE.MeshBasicMaterial({ color: 0xd4a528 });
		var rope = new THREE.Mesh(ropeGeom, ropeMat);
		rope.rotation.z = Math.PI / 2.3;
		rope.position.set(3.8, 0.45, 0);
		boatGroup.add(rope);

		boatGroup.position.set(-6.4, 0, -20.0);
		boatGroup.rotation.y = -0.32;
		return boatGroup;
	}

	function buildBoat2Speedboat() {
		// Boat 2 (Right): Sleek Open Speedboat (Cream hull, teak deck & outboard motor)
		var boatGroup = new THREE.Group();
		var boatPos = [];
		var boatCol = [];
		var m = new THREE.Matrix4();
		var rotM = new THREE.Matrix4();
		var transM = new THREE.Matrix4();

		// Sleek Hull
		var hullGeom = new THREE.BoxGeometry(1.50, 0.65, 4.20);
		m.makeTranslation(0, 0.12, 0);
		appendGeometryWithColor(hullGeom, m, 0xf6f6f2, boatPos, boatCol);

		// Pointed V-Bow
		var bowGeom = new THREE.ConeGeometry(0.75, 1.60, 4);
		rotM.makeRotationX(-Math.PI / 2);
		transM.makeTranslation(0, 0.12, -2.60);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(bowGeom, m, 0xf6f6f2, boatPos, boatCol);

		// Teak Wooden Foredeck & Gunwales
		var teakGeom = new THREE.BoxGeometry(1.42, 0.08, 1.60);
		m.makeTranslation(0, 0.46, -1.80);
		appendGeometryWithColor(teakGeom, m, 0xaa7842, boatPos, boatCol);

		// Small Windshield
		var shieldGeom = new THREE.BoxGeometry(1.30, 0.28, 0.04);
		rotM.makeRotationX(0.35);
		transM.makeTranslation(0, 0.65, -0.90);
		m.multiplyMatrices(transM, rotM);
		appendGeometryWithColor(shieldGeom, m, 0x93c5fd, boatPos, boatCol);

		// Outboard Motor at Stern
		var motorGeom = new THREE.BoxGeometry(0.35, 0.65, 0.45);
		m.makeTranslation(0, 0.25, 2.25);
		appendGeometryWithColor(motorGeom, m, 0x222226, boatPos, boatCol);

		var mergedGeom = new THREE.BufferGeometry();
		mergedGeom.setAttribute('position', new THREE.Float32BufferAttribute(boatPos, 3));
		mergedGeom.setAttribute('color', new THREE.Float32BufferAttribute(boatCol, 3));
		mergedGeom.computeVertexNormals();

		var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
		var mesh = new THREE.Mesh(mergedGeom, mat);
		boatGroup.add(mesh);

		// Mooring Buoy nearby
		var buoyGeom = new THREE.SphereGeometry(0.24, 8, 8);
		var buoyMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
		var buoy = new THREE.Mesh(buoyGeom, buoyMat);
		buoy.position.set(-1.8, 0.08, -3.2);
		boatGroup.add(buoy);

		boatGroup.position.set(5.6, 0, -21.0);
		boatGroup.rotation.y = 0.35;
		return boatGroup;
	}

	function buildSeagullMesh() {
		var g = new THREE.Group();
		var bodyGeom = new THREE.ConeGeometry(0.12, 0.65, 4);
		bodyGeom.rotateX(Math.PI / 2);
		var whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
		var body = new THREE.Mesh(bodyGeom, whiteMat);
		g.add(body);

		var wingGeom = new THREE.BoxGeometry(0.68, 0.02, 0.18);
		wingGeom.translate(0.34, 0, 0);
		var leftWing = new THREE.Mesh(wingGeom, whiteMat);
		var rightWing = new THREE.Mesh(wingGeom, whiteMat);
		rightWing.rotation.y = Math.PI;
		g.add(leftWing);
		g.add(rightWing);
		g.userData = { leftWing: leftWing, rightWing: rightWing };
		return g;
	}

	function ocean3DInit() {
		if (ocean3D.initialized) return true;
		if (typeof THREE === 'undefined') return false;
		var container = document.getElementById('scenery-container');
		if (!container) return false;

		try {
			var canvas = null;
			var renderer = null;
			if (!IS_ANDROID) {
				canvas = document.createElement('canvas');
				canvas.id = 'scenery-ocean-3d-canvas';
				canvas.className = 'scenery-ocean-3d-canvas';
				var vignette = document.getElementById('scenery-vignette');
				container.insertBefore(canvas, vignette || null);

				renderer = new THREE.WebGLRenderer({
					canvas: canvas,
					antialias: true,
					alpha: false,
					powerPreference: 'high-performance'
				});
				renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
				renderer.setClearColor(0x0284c7, 1);
				renderer.outputEncoding = THREE.sRGBEncoding;
				if (typeof THREE.ACESFilmicToneMapping !== 'undefined') {
					renderer.toneMapping = THREE.ACESFilmicToneMapping;
					renderer.toneMappingExposure = 1.08;
				}
			}

			var scene = new THREE.Scene();
			scene.fog = new THREE.FogExp2(0xa0e0f8, 0.0008);

			var camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1.0, 500);

			ocean3D.canvas = canvas;
			ocean3D.renderer = renderer;
			ocean3D.scene = scene;
			ocean3D.camera = camera;
			ocean3D.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

			// 1. Radiant Caribbean Sky Dome
			var skyDome = new THREE.Mesh(
				new THREE.SphereGeometry(320, 24, 16),
				new THREE.MeshBasicMaterial({
					map: createTropicalSkyTexture(),
					side: THREE.BackSide,
					fog: false,
					depthWrite: false
				})
			);
			skyDome.position.set(0, 0, -30);
			scene.add(skyDome);

			// 2. Tropical Sun & Sky Hemisphere Lighting
			var hemiLight = new THREE.HemisphereLight(0xa5e5fc, 0xd5c4a1, 0.75);
			scene.add(hemiLight);

			var dirSun = new THREE.DirectionalLight(0xfffbe6, 1.40);
			dirSun.position.set(32, 48, 18);
			scene.add(dirSun);

			var fillLight = new THREE.DirectionalLight(0xa5f3fc, 0.42);
			fillLight.position.set(-28, 24, -12);
			scene.add(fillLight);

			// 3. High-DPI Soft Natural Cumulus Cloud System
			ocean3D.clouds = [];
			var cloudTex0 = createSoftCumulusCloudTexture(0);
			var cloudTex1 = createSoftCumulusCloudTexture(1);
			var cloudTex2 = createSoftCumulusCloudTexture(2);
			var cloudTex3 = createSoftCumulusCloudTexture(3);

			var cloudMats = [
				new THREE.MeshBasicMaterial({ map: cloudTex0, transparent: true, depthWrite: false, opacity: 0.98, fog: false }),
				new THREE.MeshBasicMaterial({ map: cloudTex1, transparent: true, depthWrite: false, opacity: 0.95, fog: false }),
				new THREE.MeshBasicMaterial({ map: cloudTex2, transparent: true, depthWrite: false, opacity: 0.92, fog: false }),
				new THREE.MeshBasicMaterial({ map: cloudTex3, transparent: true, depthWrite: false, opacity: 0.88, fog: false })
			];

			var cloudConfigs = [
				{ x: -8,  y: 34, z: -70, sx: 56, sy: 26, speed: 0.28, matIdx: 0, minX: -65, maxX: 65, phase: 0.0 },
				{ x: 22,  y: 30, z: -65, sx: 48, sy: 22, speed: 0.32, matIdx: 1, minX: -65, maxX: 65, phase: 1.4 },
				{ x: -22, y: 26, z: -55, sx: 38, sy: 18, speed: 0.40, matIdx: 2, minX: -55, maxX: 55, phase: 2.8 },
				{ x: 4,   y: 40, z: -90, sx: 70, sy: 22, speed: 0.20, matIdx: 3, minX: -75, maxX: 75, phase: 0.6 },
				{ x: 30,  y: 22, z: -85, sx: 46, sy: 20, speed: 0.35, matIdx: 1, minX: -70, maxX: 70, phase: 4.0 },
				{ x: -32, y: 24, z: -80, sx: 44, sy: 19, speed: 0.38, matIdx: 0, minX: -70, maxX: 70, phase: 5.2 }
			];

			var cloudGeom = new THREE.PlaneGeometry(1, 1);
			for (var ci = 0; ci < cloudConfigs.length; ci++) {
				var cfg = cloudConfigs[ci];
				var cMesh = new THREE.Mesh(cloudGeom, cloudMats[cfg.matIdx]);
				cMesh.position.set(cfg.x, cfg.y, cfg.z);
				cMesh.scale.set(cfg.sx, cfg.sy, 1.0);
				scene.add(cMesh);
				ocean3D.clouds.push({
					mesh: cMesh,
					speed: cfg.speed,
					baseY: cfg.y,
					minX: cfg.minX,
					maxX: cfg.maxX,
					phase: cfg.phase
				});
			}

			// 4. Distant Coral Barrier Reef Line
			var reefGeom = new THREE.PlaneGeometry(280, 5.5);
			var reefMat = new THREE.MeshBasicMaterial({ color: 0x01586d, transparent: true, opacity: 0.38 });
			var reefMesh = new THREE.Mesh(reefGeom, reefMat);
			reefMesh.rotation.x = -Math.PI / 2;
			reefMesh.position.set(0, 0.01, -142);
			scene.add(reefMesh);

			// 5. Physically-Based Custom Tropical Water Shader
			var waterGeom = new THREE.PlaneGeometry(280, 240, 110, 90);
			waterGeom.rotateX(-Math.PI / 2);
			var waterMat = buildTropicalWaterMaterial();
			var waterMesh = new THREE.Mesh(waterGeom, waterMat);
			waterMesh.position.set(0, 0, -20);
			scene.add(waterMesh);
			ocean3D.waterMesh = waterMesh;
			ocean3D.waterMaterial = waterMat;

			// 6. Full 3D Wooden Pier & Pigeon Point Thatched Cabana
			var geoms = buildPierAndCabanaGeometries();
			var woodMat = new THREE.MeshLambertMaterial({ vertexColors: true });
			var pierMesh = new THREE.Mesh(geoms.pierGeom, woodMat);
			scene.add(pierMesh);

			var thatchMat = new THREE.MeshLambertMaterial({ vertexColors: true });
			var thatchMesh = new THREE.Mesh(geoms.thatchGeom, thatchMat);
			scene.add(thatchMesh);

			// 7. Authentic Tropical Boats
			ocean3D.boat1 = buildBoat1PassengerTaxi();
			scene.add(ocean3D.boat1);

			ocean3D.boat2 = buildBoat2Speedboat();
			scene.add(ocean3D.boat2);

			// 8. Soaring Sea Terns / Seagulls
			ocean3D.seagulls = [];
			var sConfigs = [
				{ cx: 8,  cy: 24, cz: -65, r: 16, speed: 0.65, phase: 0.0 },
				{ cx: -18, cy: 27, cz: -85, r: 22, speed: 0.52, phase: 2.2 },
				{ cx: 28, cy: 22, cz: -55, r: 12, speed: 0.78, phase: 4.1 }
			];
			for (var si = 0; si < sConfigs.length; si++) {
				var sc = sConfigs[si];
				var sg = buildSeagullMesh();
				scene.add(sg);
				ocean3D.seagulls.push({
					mesh: sg,
					cx: sc.cx,
					cy: sc.cy,
					cz: sc.cz,
					r: sc.r,
					speed: sc.speed,
					phase: sc.phase
				});
			}

			ocean3D.initialized = true;
			ocean3DResize();
			return true;
		} catch (e) {
			console.error('WordChain: ocean3DInit exception', e);
			return false;
		}
	}

	function ocean3DResize() {
		if (!ocean3D.initialized || !ocean3D.camera) return;
		var w = window.innerWidth || 390;
		var h = window.innerHeight || 844;
		if (w === ocean3D.width && h === ocean3D.height) return;
		ocean3D.width = w;
		ocean3D.height = h;
		if (ocean3D.renderer) {
			ocean3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
			ocean3D.renderer.setSize(w, h, false);
		}
		var aspect = w / h;
		ocean3D.camera.aspect = aspect;
		ocean3D.camera.fov = (aspect < 0.65) ? 48 : 45;
		ocean3D.camera.updateProjectionMatrix();
	}

	function ocean3DUpdate(dt, now) {
		if (!ocean3D.active || !ocean3D.initialized) return;
		dt = Math.min(dt || 0.016, 0.05);
		var t = ((now - ocean3D.startTime) * 0.001);

		// 1. Camera eye-level perspective standing on the wooden pier looking toward the cabana
		var camX = Math.sin(t * 0.18) * 0.12;
		var camY = 3.80 + Math.cos(t * 0.14) * 0.06;
		ocean3D.camera.position.set(camX, camY, 14.0);
		ocean3D.camera.lookAt(camX * 0.25, 3.30, -38.0);

		// 2. Animate Water Waves & Caustics
		if (ocean3D.waterMaterial && ocean3D.waterMaterial.uniforms) {
			ocean3D.waterMaterial.uniforms.uTime.value = t;
		}

		// 3. Gentle Trade Wind Atmospheric Cloud Drift
		for (var ci = 0; ci < ocean3D.clouds.length; ci++) {
			var cObj = ocean3D.clouds[ci];
			cObj.mesh.position.x += cObj.speed * dt * 2.2;
			cObj.mesh.position.y = cObj.baseY + Math.sin(t * 0.22 + cObj.phase) * 0.28;
			if (cObj.mesh.position.x > cObj.maxX) {
				cObj.mesh.position.x = cObj.minX;
			}
		}

		// 4. Bobbing Boats (Left Passenger Taxi & Right Speedboat)
		if (ocean3D.boat1) {
			var b1Heave = Math.sin(t * 1.45) * 0.09;
			var b1Pitch = Math.cos(t * 1.25) * 0.042;
			var b1Roll  = Math.sin(t * 1.55 + 0.6) * 0.052;
			ocean3D.boat1.position.y = b1Heave;
			ocean3D.boat1.rotation.x = b1Pitch;
			ocean3D.boat1.rotation.z = b1Roll;
		}
		if (ocean3D.boat2) {
			var b2Heave = Math.sin(t * 1.55 + 1.8) * 0.085;
			var b2Pitch = Math.cos(t * 1.35 + 1.2) * 0.046;
			var b2Roll  = Math.sin(t * 1.65 + 2.5) * 0.056;
			ocean3D.boat2.position.y = b2Heave;
			ocean3D.boat2.rotation.x = b2Pitch;
			ocean3D.boat2.rotation.z = b2Roll;
		}

		// 5. Seagulls Soaring in Thermals
		for (var si = 0; si < ocean3D.seagulls.length; si++) {
			var sgObj = ocean3D.seagulls[si];
			var ang = t * sgObj.speed + sgObj.phase;
			var sx = sgObj.cx + Math.cos(ang) * sgObj.r;
			var sz = sgObj.cz + Math.sin(ang) * (sgObj.r * 0.7);
			var sy = sgObj.cy + Math.sin(t * 0.8 + sgObj.phase) * 1.2;
			sgObj.mesh.position.set(sx, sy, sz);
			sgObj.mesh.rotation.y = -ang + Math.PI / 2;

			var ud = sgObj.mesh.userData;
			if (ud && ud.leftWing && ud.rightWing) {
				var flap = Math.sin(t * 3.8 + sgObj.phase) * 0.24;
				ud.leftWing.rotation.z = flap;
				ud.rightWing.rotation.z = -flap;
			}
		}

		// Render on iOS / macOS / Desktop
		if (ocean3D.renderer) {
			ocean3D.renderer.render(ocean3D.scene, ocean3D.camera);
		}
	}

	function ocean3DSetActive(isActive) {
		if (isActive) {
			if (ocean3DInit()) {
				ocean3D.active = true;
				ocean3DResize();
				if (ocean3D.canvas) ocean3D.canvas.classList.add('active');
				ocean3DUpdate(0.016, typeof performance !== 'undefined' ? performance.now() : Date.now());
			}
		} else {
			ocean3D.active = false;
			if (ocean3D.canvas) ocean3D.canvas.classList.remove('active');
		}
	}

	// --------------------------------------------------------------------------
	// REAL-TIME THREE.JS 3D VOLCANO NIGHT ERUPTION SCENE (MOBILE PORTRAIT)
	// Inspired by nocturnal stratovolcano eruption (Volcán de Fuego):
	// - Parametric composite stratovolcano cone with steep gullies & caldera crater
	// - Procedural animated glowing lava rivers cascading down gullies
	// - Ballistic tephra explosion fountain erupting from summit caldera
	// - Billowing ash & smoke column backlit by crater fire
	// - Long-exposure vertical star trails across deep obsidian night sky
	// --------------------------------------------------------------------------
	var volcano3D = {
		initialized: false,
		active: false,
		canvas: null,
		renderer: null,
		scene: null,
		camera: null,
		width: 0,
		height: 0,
		startTime: 0,
		volcanoMesh: null,
		volcanoMaterial: null,
		starTrails: null,
		starTrailsMaterial: null,
		magmaFountain: null,
		fountainColumn: null,
		fountainPoints: null,
		calderaGlowLight: null,
		ashPlumes: []
	};

	function createEruptionColumnTexture() {
		var c = document.createElement('canvas');
		c.width = 64;
		c.height = 256;
		var ctx = c.getContext('2d');
		var grad = ctx.createLinearGradient(0, 0, 0, 256);
		grad.addColorStop(0.00, 'rgba(255, 60, 0, 0.0)');
		grad.addColorStop(0.25, 'rgba(255, 110, 10, 0.50)');
		grad.addColorStop(0.55, 'rgba(255, 170, 25, 0.85)');
		grad.addColorStop(0.82, 'rgba(255, 235, 130, 0.95)');
		grad.addColorStop(1.00, 'rgba(255, 255, 245, 1.0)');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 64, 256);
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		return tex;
	}

	function createVolcanoSkyTexture() {
		var c = document.createElement('canvas');
		c.width = 64;
		c.height = 512;
		var ctx = c.getContext('2d');
		var grad = ctx.createLinearGradient(0, 0, 0, 512);
		grad.addColorStop(0.00, '#040206');
		grad.addColorStop(0.28, '#08040d');
		grad.addColorStop(0.55, '#130811');
		grad.addColorStop(0.78, '#220b0f');
		grad.addColorStop(0.94, '#2e0e0a');
		grad.addColorStop(1.00, '#1c0706');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 64, 512);
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		return tex;
	}

	function createTephraParticleTexture() {
		var c = document.createElement('canvas');
		c.width = 64;
		c.height = 64;
		var ctx = c.getContext('2d');
		var grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
		grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
		grad.addColorStop(0.2, 'rgba(255, 235, 170, 0.95)');
		grad.addColorStop(0.5, 'rgba(255, 110, 20, 0.70)');
		grad.addColorStop(0.8, 'rgba(210, 30, 0, 0.30)');
		grad.addColorStop(1.0, 'rgba(160, 0, 0, 0.0)');
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(32, 32, 30, 0, Math.PI * 2);
		ctx.fill();
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		return tex;
	}

	function createVolcanoAshPlumeTexture() {
		var c = document.createElement('canvas');
		c.width = 128;
		c.height = 128;
		var ctx = c.getContext('2d');
		var grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
		grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.85)');
		grad.addColorStop(0.35, 'rgba(240, 215, 205, 0.60)');
		grad.addColorStop(0.70, 'rgba(180, 155, 150, 0.28)');
		grad.addColorStop(1.0, 'rgba(100, 90, 95, 0.0)');
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(64, 64, 60, 0, Math.PI * 2);
		ctx.fill();
		var tex = new THREE.CanvasTexture(c);
		tex.generateMipmaps = false;
		return tex;
	}

	function buildVolcanoStarTrails() {
		var streakCount = 140;
		var positions = new Float32Array(streakCount * 6);
		var colors = new Float32Array(streakCount * 6);

		var starPalettes = [
			[1.0, 0.95, 0.85],
			[0.85, 0.92, 1.0],
			[1.0, 0.80, 0.55],
			[0.95, 0.88, 0.98]
		];

		for (var i = 0; i < streakCount; i++) {
			var x = (Math.random() - 0.5) * 85.0;
			var y = 6.0 + Math.random() * 38.0;
			var z = -48.0 + Math.random() * 22.0;

			var len = 1.8 + Math.random() * 2.8;
			var dx = -0.08 * len;
			var dy = len;

			var pal = starPalettes[Math.floor(Math.random() * starPalettes.length)];
			var brightness = 0.45 + Math.random() * 0.55;

			var i6 = i * 6;
			positions[i6 + 0] = x;
			positions[i6 + 1] = y;
			positions[i6 + 2] = z;
			positions[i6 + 3] = x + dx;
			positions[i6 + 4] = y - dy;
			positions[i6 + 5] = z;

			colors[i6 + 0] = pal[0] * brightness * 0.35;
			colors[i6 + 1] = pal[1] * brightness * 0.35;
			colors[i6 + 2] = pal[2] * brightness * 0.35;

			colors[i6 + 3] = pal[0] * brightness;
			colors[i6 + 4] = pal[1] * brightness;
			colors[i6 + 5] = pal[2] * brightness;
		}

		var geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

		var mat = new THREE.LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.82,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		volcano3D.starTrailsMaterial = mat;

		return new THREE.LineSegments(geom, mat);
	}

	function buildVolcanoGeometry() {
		var radialSegs = 64;
		var heightRings = 44;
		var vertices = [];
		var uvs = [];
		var indices = [];

		for (var r = 0; r <= heightRings; r++) {
			var v = r / heightRings;
			var y = 0;
			var radius = 0;

			if (v < 0.95) {
				var coneT = v / 0.95;
				y = -12.0 + coneT * 32.2;
				radius = 28.0 * Math.pow(1.0 - coneT * 0.90, 1.45) + 1.6;
			} else {
				var craterT = (v - 0.95) / 0.05;
				y = 20.2 - Math.sin(craterT * Math.PI * 0.5) * 1.4;
				radius = 1.6 - craterT * 1.2;
			}

			for (var s = 0; s <= radialSegs; s++) {
				var u = s / radialSegs;
				var theta = u * Math.PI * 2.0;

				var ridgeNoise = 0;
				if (v < 0.95) {
					var flankWeight = Math.sin(v / 0.95 * Math.PI);
					ridgeNoise = (
						Math.sin(theta * 7.0) * 0.70 +
						Math.sin(theta * 13.0 + 1.2) * 0.35 +
						Math.sin(theta * 23.0) * 0.18
					) * flankWeight;

					var frontAngle = Math.abs(theta - Math.PI * 0.5);
					if (frontAngle < 0.55 && v > 0.85) {
						y -= (0.55 - frontAngle) * 1.2 * ((v - 0.85) / 0.10);
					}
				}

				var modRadius = Math.max(0.3, radius + ridgeNoise);
				var x = Math.cos(theta) * modRadius;
				var z = Math.sin(theta) * modRadius;

				vertices.push(x, y, z);
				uvs.push(u, v);
			}
		}

		var rowStride = radialSegs + 1;
		for (var ri = 0; ri < heightRings; ri++) {
			for (var si = 0; si < radialSegs; si++) {
				var i0 = ri * rowStride + si;
				var i1 = (ri + 1) * rowStride + si;
				var i2 = (ri + 1) * rowStride + (si + 1);
				var i3 = ri * rowStride + (si + 1);

				indices.push(i0, i1, i2);
				indices.push(i0, i2, i3);
			}
		}

		var geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
		geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geom.setIndex(indices);
		geom.computeVertexNormals();
		return geom;
	}

	function buildVolcanoShaderMaterial() {
		var vShader = [
			'varying vec3 vWorldPosition;',
			'varying vec3 vNormal;',
			'varying vec2 vUv;',
			'void main() {',
			'    vUv = uv;',
			'    vNormal = normalize(normalMatrix * normal);',
			'    vec4 worldPos = modelMatrix * vec4(position, 1.0);',
			'    vWorldPosition = worldPos.xyz;',
			'    gl_Position = projectionMatrix * viewMatrix * worldPos;',
			'}'
		].join('\n');

		var fShader = [
			'uniform float uTime;',
			'uniform float uCalderaIntensity;',
			'varying vec3 vWorldPosition;',
			'varying vec3 vNormal;',
			'varying vec2 vUv;',
			'',
			'void main() {',
			'    vec3 localPos = vWorldPosition - vec3(0.0, 0.0, -35.0);',
			'    float h = clamp((localPos.y + 12.0) / 32.2, 0.0, 1.0);',
			'    float theta = atan(localPos.x, localPos.z);',
			'    float r = length(localPos.xz);',
			'',
			'    // Rugged volcanic basalt rock with light & shadow facets',
			'    vec3 lightDir = normalize(vec3(0.4, 0.9, 0.3));',
			'    float diffuse = clamp(dot(vNormal, lightDir), 0.0, 1.0);',
			'    vec3 colRock = mix(vec3(0.025, 0.022, 0.032), vec3(0.065, 0.058, 0.075), h);',
			'    colRock += vec3(0.04, 0.05, 0.08) * diffuse;',
			'',
			'    // Caldera crater interior churning lake of magma',
			'    if (localPos.y >= 18.5 && r < 1.7) {',
			'        float boil = sin(localPos.x * 5.0 + uTime * 4.5) * cos(localPos.z * 5.0 - uTime * 4.0) * 0.5 + 0.5;',
			'        float cEdge = clamp(r / 1.6, 0.0, 1.0);',
			'        vec3 craterLava = mix(vec3(1.0, 0.98, 0.88), vec3(1.0, 0.50, 0.04), cEdge);',
			'        craterLava = mix(craterLava, vec3(0.85, 0.10, 0.01), cEdge * cEdge);',
			'        craterLava *= (0.92 + 0.15 * sin(uTime * 4.0 + boil));',
			'        gl_FragColor = vec4(craterLava * uCalderaIntensity * 1.35, 1.0);',
			'        return;',
			'    }',
			'',
			'    // Central breach flow cascading down front (theta ~ 0)',
			'    float cPath = 0.07 * sin(h * 9.5 + 0.3) + 0.03 * sin(h * 20.0);',
			'    float dCenter = abs(theta - cPath);',
			'    float wCenter = 0.040 * (1.0 - h * 0.35);',
			'    float f1 = smoothstep(0.0, 1.0, clamp(1.0 - dCenter / wCenter, 0.0, 1.0));',
			'    float streamY1 = h * 16.0 - uTime * 0.55;',
			'    f1 *= (0.78 + 0.22 * sin(streamY1 * 6.28 + localPos.x * 2.0));',
			'',
			'    // Left braided finger branching off central river',
			'    float br1Path = cPath - 0.09 * sin(h * 13.5);',
			'    float dBr1 = abs(theta - br1Path);',
			'    float wBr1 = 0.026 * smoothstep(0.92, 0.65, h) * smoothstep(0.08, 0.35, h);',
			'    float fBr1 = smoothstep(0.0, 1.0, clamp(1.0 - dBr1 / max(0.001, wBr1), 0.0, 1.0));',
			'    fBr1 *= (0.76 + 0.24 * sin((h * 15.0 - uTime * 0.52) * 6.28));',
			'',
			'    // Right braided finger branching off central river',
			'    float br2Path = cPath + 0.10 * cos(h * 14.5);',
			'    float dBr2 = abs(theta - br2Path);',
			'    float wBr2 = 0.026 * smoothstep(0.88, 0.60, h) * smoothstep(0.08, 0.35, h);',
			'    float fBr2 = smoothstep(0.0, 1.0, clamp(1.0 - dBr2 / max(0.001, wBr2), 0.0, 1.0));',
			'    fBr2 *= (0.76 + 0.24 * sin((h * 15.5 - uTime * 0.54) * 6.28));',
			'',
			'    // Left shoulder river (visible beside board)',
			'    float lPath = -0.38 + 0.06 * sin(h * 9.0 + 1.2);',
			'    float dLeft = abs(theta - lPath);',
			'    float wLeft = 0.035 * (1.0 - h * 0.30);',
			'    float f2 = smoothstep(0.0, 1.0, clamp(1.0 - dLeft / wLeft, 0.0, 1.0));',
			'    float streamY2 = h * 13.0 - uTime * 0.48;',
			'    f2 *= (0.78 + 0.22 * sin(streamY2 * 6.28 - localPos.z));',
			'',
			'    // Secondary tributary off left shoulder',
			'    float lSubPath = lPath + 0.06 * sin(h * 16.0);',
			'    float dLSub = abs(theta - lSubPath);',
			'    float wLSub = 0.022 * smoothstep(0.80, 0.55, h) * smoothstep(0.08, 0.28, h);',
			'    float fLSub = smoothstep(0.0, 1.0, clamp(1.0 - dLSub / max(0.001, wLSub), 0.0, 1.0));',
			'',
			'    // Right shoulder river (visible beside board)',
			'    float rPath = 0.40 - 0.06 * cos(h * 9.5 + 0.7);',
			'    float dRight = abs(theta - rPath);',
			'    float wRight = 0.035 * (1.0 - h * 0.30);',
			'    float f3 = smoothstep(0.0, 1.0, clamp(1.0 - dRight / wRight, 0.0, 1.0));',
			'    float streamY3 = h * 14.0 - uTime * 0.50;',
			'    f3 *= (0.78 + 0.22 * sin(streamY3 * 6.28 + localPos.z));',
			'',
			'    // Secondary tributary off right shoulder',
			'    float rSubPath = rPath - 0.06 * cos(h * 16.5);',
			'    float dRSub = abs(theta - rSubPath);',
			'    float wRSub = 0.022 * smoothstep(0.80, 0.55, h) * smoothstep(0.08, 0.28, h);',
			'    float fRSub = smoothstep(0.0, 1.0, clamp(1.0 - dRSub / max(0.001, wRSub), 0.0, 1.0));',
			'',
			'    // Flank braids',
			'    float dFlankL = abs(theta - (-0.68 + 0.03 * sin(h * 11.0)));',
			'    float wFlankL = 0.022 * smoothstep(0.88, 0.60, h) * smoothstep(0.05, 0.25, h);',
			'    float f6 = smoothstep(0.0, 1.0, clamp(1.0 - dFlankL / max(0.001, wFlankL), 0.0, 1.0));',
			'',
			'    float dFlankR = abs(theta - (0.72 - 0.03 * cos(h * 11.0)));',
			'    float wFlankR = 0.022 * smoothstep(0.88, 0.60, h) * smoothstep(0.05, 0.25, h);',
			'    float f7 = smoothstep(0.0, 1.0, clamp(1.0 - dFlankR / max(0.001, wFlankR), 0.0, 1.0));',
			'',
			'    // Combine lava intensity',
			'    float lava = max(f1, max(fBr1, max(fBr2, max(f2, max(fLSub, max(f3, max(fRSub, max(f6, f7))))))));',
			'    float minDist = min(dCenter, min(dBr1, min(dBr2, min(dLeft, min(dRight, min(dFlankL, dFlankR))))));',
			'',
			'    // Tight, crisp ambient bounce onto adjacent basalt rock',
			'    float bounce = exp(-minDist * 32.0) * 0.40;',
			'    colRock += vec3(0.95, 0.20, 0.02) * bounce;',
			'    if (h > 0.92) {',
			'        colRock += vec3(0.90, 0.32, 0.04) * smoothstep(0.92, 0.99, h) * (0.50 + 0.15 * sin(uTime * 3.8));',
			'    }',
			'',
			'    // Incandescent lava color ramp',
			'    vec3 colLava = vec3(0.0);',
			'    if (lava > 0.60) {',
			'        colLava = mix(vec3(1.0, 0.58, 0.06), vec3(1.0, 1.0, 0.94), (lava - 0.60) / 0.40);',
			'    } else if (lava > 0.22) {',
			'        colLava = mix(vec3(0.92, 0.10, 0.01), vec3(1.0, 0.58, 0.06), (lava - 0.22) / 0.38);',
			'    } else {',
			'        colLava = mix(vec3(0.18, 0.02, 0.01), vec3(0.92, 0.10, 0.01), lava / 0.22);',
			'    }',
			'    colLava *= uCalderaIntensity;',
			'',
			'    vec3 finalColor = mix(colRock, colLava, smoothstep(0.02, 0.18, lava));',
			'    gl_FragColor = vec4(finalColor, 1.0);',
			'}'
		].join('\n');

		return new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uCalderaIntensity: { value: 1.0 }
			},
			vertexShader: vShader,
			fragmentShader: fShader
		});
	}

	function buildMagmaFountain() {
		var group = new THREE.Group();

		// 1. Incandescent Geyser / Eruption Core Column
		var colGeom = new THREE.CylinderGeometry(0.55, 0.90, 4.8, 16, 1, true);
		var colMat = new THREE.MeshBasicMaterial({
			map: createEruptionColumnTexture(),
			transparent: true,
			opacity: 0.94,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			depthWrite: false
		});
		var colMesh = new THREE.Mesh(colGeom, colMat);
		colMesh.position.set(0, 22.4, -34.8);
		colMesh.renderOrder = 2;
		group.add(colMesh);
		volcano3D.fountainColumn = colMesh;

		// 2. Ballistic Tephra Particles
		var pCount = 140;
		var positions = new Float32Array(pCount * 3);
		var colors = new Float32Array(pCount * 3);
		var particles = [];

		for (var i = 0; i < pCount; i++) {
			var angle = Math.random() * Math.PI * 2;
			var rad = Math.random() * 0.75;
			var x = Math.cos(angle) * rad;
			var y = 19.8 + Math.random() * 0.4;
			var z = -34.8 + Math.sin(angle) * rad;

			var vx = (Math.random() - 0.5) * 3.4;
			var vy = 11.0 + Math.random() * 12.0;
			var vz = (Math.random() - 0.5) * 3.4;

			var i3 = i * 3;
			positions[i3 + 0] = x;
			positions[i3 + 1] = y;
			positions[i3 + 2] = z;

			colors[i3 + 0] = 1.0;
			colors[i3 + 1] = 0.98;
			colors[i3 + 2] = 0.90;

			particles.push({
				x: x, y: y, z: z,
				vx: vx, vy: vy, vz: vz,
				life: Math.random() * 1.5,
				maxLife: 1.1 + Math.random() * 0.9
			});
		}

		var geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

		var mat = new THREE.PointsMaterial({
			size: 2.6,
			map: createTephraParticleTexture(),
			vertexColors: true,
			transparent: true,
			opacity: 1.0,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});

		var pSystem = new THREE.Points(geom, mat);
		pSystem.renderOrder = 3;
		pSystem.userData.particles = particles;
		group.add(pSystem);
		volcano3D.fountainPoints = pSystem;

		return group;
	}

	function buildAshPlumes(scene) {
		var plumeCount = 6;
		var plumes = [];
		var plumeTex = createVolcanoAshPlumeTexture();

		var plumeConfigs = [
			{ y: 21.5, scale: 7.5, color: 0xff4411, opacity: 0.58, riseSpeed: 0.85, rotSpeed: 0.05 },
			{ y: 24.5, scale: 10.5, color: 0xdd3311, opacity: 0.48, riseSpeed: 0.95, rotSpeed: -0.04 },
			{ y: 28.5, scale: 14.0, color: 0xaa2211, opacity: 0.40, riseSpeed: 1.05, rotSpeed: 0.03 },
			{ y: 33.5, scale: 18.0, color: 0x661814, opacity: 0.32, riseSpeed: 1.15, rotSpeed: -0.03 },
			{ y: 39.5, scale: 22.0, color: 0x331012, opacity: 0.28, riseSpeed: 1.25, rotSpeed: 0.02 },
			{ y: 46.5, scale: 26.0, color: 0x180a0c, opacity: 0.22, riseSpeed: 1.35, rotSpeed: -0.02 }
		];

		var plumeGroup = new THREE.Group();

		for (var i = 0; i < plumeCount; i++) {
			var cfg = plumeConfigs[i];
			var pGeom = new THREE.PlaneGeometry(16, 16);
			var pMat = new THREE.MeshBasicMaterial({
				map: plumeTex,
				color: cfg.color,
				transparent: true,
				opacity: cfg.opacity,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending
			});

			var pMesh = new THREE.Mesh(pGeom, pMat);
			pMesh.position.set((Math.random() - 0.5) * 1.5, cfg.y, -34.5);
			pMesh.scale.set(cfg.scale / 16, cfg.scale / 16, 1.0);
			pMesh.rotation.z = Math.random() * Math.PI * 2;
			pMesh.renderOrder = 4;

			plumeGroup.add(pMesh);
			plumes.push({
				mesh: pMesh,
				baseY: cfg.y,
				riseSpeed: cfg.riseSpeed,
				rotSpeed: cfg.rotSpeed,
				baseScale: cfg.scale / 16
			});
		}

		scene.add(plumeGroup);
		volcano3D.ashPlumes = plumes;
	}

	function volcano3DInit() {
		if (volcano3D.initialized) return true;
		if (typeof THREE === 'undefined') return false;
		var container = document.getElementById('scenery-container');
		if (!container) return false;

		try {
			var canvas = null;
			var renderer = null;
			if (!IS_ANDROID) {
				canvas = document.createElement('canvas');
				canvas.id = 'scenery-volcano-3d-canvas';
				canvas.className = 'scenery-volcano-3d-canvas';
				var vignette = document.getElementById('scenery-vignette');
				container.insertBefore(canvas, vignette || null);

				renderer = new THREE.WebGLRenderer({
					canvas: canvas,
					antialias: true,
					alpha: false,
					powerPreference: 'high-performance'
				});
				renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
				renderer.setClearColor(0x060308, 1);
			}

			var scene = new THREE.Scene();
			scene.fog = new THREE.FogExp2(0x060308, 0.008);

			var camera = new THREE.PerspectiveCamera(48, 1.0, 0.1, 300);
			camera.position.set(0, 4.0, 15.0);
			camera.lookAt(0, 7.0, -35.0);

			volcano3D.canvas = canvas;
			volcano3D.renderer = renderer;
			volcano3D.scene = scene;
			volcano3D.camera = camera;
			volcano3D.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

			// 1. Sky Dome Cylinder with nocturnal gradient
			var skyGeom = new THREE.CylinderGeometry(85, 85, 95, 32, 1, true);
			skyGeom.scale(-1, 1, 1);
			var skyMat = new THREE.MeshBasicMaterial({
				map: createVolcanoSkyTexture(),
				side: THREE.BackSide,
				depthWrite: false
			});
			var skyMesh = new THREE.Mesh(skyGeom, skyMat);
			skyMesh.position.set(0, 15.0, -35.0);
			scene.add(skyMesh);

			// 2. Star Trails (long-exposure astrophotography streaks)
			volcano3D.starTrails = buildVolcanoStarTrails();
			scene.add(volcano3D.starTrails);

			// 3. Parametric Stratovolcano with animated lava cascades
			var vGeom = buildVolcanoGeometry();
			volcano3D.volcanoMaterial = buildVolcanoShaderMaterial();
			volcano3D.volcanoMesh = new THREE.Mesh(vGeom, volcano3D.volcanoMaterial);
			volcano3D.volcanoMesh.position.set(0, 0, -35.0);
			scene.add(volcano3D.volcanoMesh);

			// 4. Billowing Ash & Smoke Plumes
			buildAshPlumes(scene);

			// 5. Ballistic Tephra Magma Fountain
			volcano3D.magmaFountain = buildMagmaFountain();
			scene.add(volcano3D.magmaFountain);

			// 6. Dynamic Caldera Point Light
			volcano3D.calderaGlowLight = new THREE.PointLight(0xff5500, 3.6, 50);
			volcano3D.calderaGlowLight.position.set(0, 20.0, -34.5);
			scene.add(volcano3D.calderaGlowLight);

			// 7. Ambient & Directional Moonlight
			var ambLight = new THREE.AmbientLight(0x281214, 1.2);
			scene.add(ambLight);

			var moonLight = new THREE.DirectionalLight(0x1a243a, 0.45);
			moonLight.position.set(8, 32, 15);
			scene.add(moonLight);

			volcano3D.initialized = true;
			volcano3DResize();
			return true;
		} catch (e) {
			console.error('WordChain: volcano3DInit exception', e);
			return false;
		}
	}

	function volcano3DResize() {
		if (!volcano3D.initialized || !volcano3D.camera) return;
		var w = window.innerWidth;
		var h = window.innerHeight;
		if (w === volcano3D.width && h === volcano3D.height) return;
		volcano3D.width = w;
		volcano3D.height = h;

		if (volcano3D.renderer) {
			volcano3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
			volcano3D.renderer.setSize(w, h, false);
		}

		var aspect = w / h;
		volcano3D.camera.aspect = aspect;
		volcano3D.camera.fov = (aspect < 0.65) ? 48 : 45;
		volcano3D.camera.updateProjectionMatrix();
	}

	function volcano3DUpdate(dt, now) {
		if (!volcano3D.active || !volcano3D.initialized) return;

		var t = ((now - volcano3D.startTime) * 0.001);

		// Subtle atmospheric camera breathing
		var camX = Math.sin(t * 0.12) * 0.22;
		var camY = 4.0 + Math.cos(t * 0.15) * 0.15;
		volcano3D.camera.position.set(camX, camY, 15.0);
		volcano3D.camera.lookAt(camX * 0.20, 7.0, -35.0);

		// Update volcano shader uniforms (molten flow + eruption breathing)
		if (volcano3D.volcanoMaterial && volcano3D.volcanoMaterial.uniforms) {
			volcano3D.volcanoMaterial.uniforms.uTime.value = t;
			volcano3D.volcanoMaterial.uniforms.uCalderaIntensity.value = 1.0 + 0.15 * Math.sin(t * 3.8);
		}

		// Caldera point light pulsation
		if (volcano3D.calderaGlowLight) {
			volcano3D.calderaGlowLight.intensity = 3.2 + 0.8 * Math.sin(t * 4.2) + 0.4 * Math.cos(t * 7.5);
		}

		// Eruption Column pulsation
		if (volcano3D.fountainColumn) {
			var colScaleX = 1.0 + 0.12 * Math.sin(t * 7.5);
			var colScaleY = 1.0 + 0.15 * Math.sin(t * 5.2);
			volcano3D.fountainColumn.scale.set(colScaleX, colScaleY, colScaleX);
			volcano3D.fountainColumn.rotation.y = t * 0.4;
		}

		// Update ballistic tephra particles
		if (volcano3D.fountainPoints) {
			var pGeom = volcano3D.fountainPoints.geometry;
			var posAttr = pGeom.getAttribute('position');
			var colAttr = pGeom.getAttribute('color');
			var pPositions = posAttr.array;
			var pColors = colAttr.array;
			var pData = volcano3D.fountainPoints.userData.particles;
			var pCount = pData.length;

			for (var pi = 0; pi < pCount; pi++) {
				var p = pData[pi];
				p.life += dt;
				p.vy -= 12.0 * dt;
				p.x += p.vx * dt;
				p.y += p.vy * dt;
				p.z += p.vz * dt;

				if (p.life >= p.maxLife || p.y < 18.5) {
					var angle = Math.random() * Math.PI * 2;
					var rad = Math.random() * 0.75;
					p.x = Math.cos(angle) * rad;
					p.y = 19.8 + Math.random() * 0.4;
					p.z = -34.8 + Math.sin(angle) * rad;
					p.vx = (Math.random() - 0.5) * 2.6;
					p.vy = 10.5 + Math.random() * 11.5;
					p.vz = (Math.random() - 0.5) * 2.6;
					p.life = 0;
					p.maxLife = 1.1 + Math.random() * 0.9;
				}

				var idx = pi * 3;
				pPositions[idx + 0] = p.x;
				pPositions[idx + 1] = p.y;
				pPositions[idx + 2] = p.z;

				// Color cools down over life: white-hot -> orange -> red
				var lifeFrac = p.life / p.maxLife;
				if (lifeFrac < 0.35) {
					pColors[idx + 0] = 1.0;
					pColors[idx + 1] = 0.98 - lifeFrac * 0.6;
					pColors[idx + 2] = 0.90 - lifeFrac * 2.0;
				} else {
					pColors[idx + 0] = Math.max(0.4, 1.0 - (lifeFrac - 0.35) * 0.8);
					pColors[idx + 1] = Math.max(0.1, 0.50 - (lifeFrac - 0.35) * 0.6);
					pColors[idx + 2] = 0.05;
				}
			}
			posAttr.needsUpdate = true;
			colAttr.needsUpdate = true;
		}

		// Update billowing ash plumes
		if (volcano3D.ashPlumes) {
			for (var api = 0; api < volcano3D.ashPlumes.length; api++) {
				var plume = volcano3D.ashPlumes[api];
				plume.mesh.position.y += plume.riseSpeed * dt;
				plume.mesh.rotation.z += plume.rotSpeed * dt;
				// Wrap around at top
				if (plume.mesh.position.y > 48.0) {
					plume.mesh.position.y = 21.5;
					plume.mesh.position.x = (Math.random() - 0.5) * 1.8;
					plume.mesh.position.z = -35.0 + (Math.random() - 0.5) * 1.8;
				}
			}
		}

		// Star trails subtle twinkling
		if (volcano3D.starTrailsMaterial) {
			volcano3D.starTrailsMaterial.opacity = 0.72 + 0.12 * Math.sin(t * 1.6);
		}

		if (volcano3D.renderer) {
			volcano3D.renderer.render(volcano3D.scene, volcano3D.camera);
		}
	}

	function volcano3DSetActive(isActive) {
		if (isActive) {
			if (volcano3DInit()) {
				volcano3D.active = true;
				volcano3DResize();
				if (volcano3D.canvas) volcano3D.canvas.classList.add('active');
				volcano3DUpdate(0.016, typeof performance !== 'undefined' ? performance.now() : Date.now());
			}
		} else {
			volcano3D.active = false;
			if (volcano3D.canvas) volcano3D.canvas.classList.remove('active');
		}
	}

	// --------------------------------------------------------------------------
	// DOM PLATE MANAGEMENT (100% VISIBLE, HARDWARE-ACCELERATED KEN BURNS DRIFT)
	// --------------------------------------------------------------------------
	function ensureDOMContainers() {
		var sceneryContainer = document.getElementById('scenery-container');
		if (!sceneryContainer) {
			sceneryContainer = document.createElement('div');
			sceneryContainer.id = 'scenery-container';
			sceneryContainer.className = 'scenery-container';

			SCENERY_CYCLE_ORDER.forEach(function (key) {
				var plate = document.createElement('div');
				plate.id = 'scenery-plate-' + key;
				plate.className = 'scenery-photo-plate' + (key === currentScenery && currentScenery !== 'peaks' && currentScenery !== 'ocean' && currentScenery !== 'volcano' ? ' active' : '');
				plate.style.backgroundImage = "url('" + SCENERIES[key].photo + "')";
				sceneryContainer.appendChild(plate);
			});

			var vignette = document.createElement('div');
			vignette.id = 'scenery-vignette';
			vignette.className = 'scenery-vignette ' + SCENERIES[currentScenery].vignetteClass;
			sceneryContainer.appendChild(vignette);

			var glow = document.createElement('div');
			glow.id = 'scenery-ambient-glow';
			glow.className = 'scenery-ambient-glow ' + SCENERIES[currentScenery].glowClass;
			sceneryContainer.appendChild(glow);

			var canvasContainer = document.getElementById('canvas-container');
			if (canvasContainer && canvasContainer.parentNode) {
				canvasContainer.parentNode.insertBefore(sceneryContainer, canvasContainer);
			} else {
				document.body.insertBefore(sceneryContainer, document.body.firstChild);
			}
		}

		// Ensure background particle canvas (BEHIND board) exists inside sceneryContainer
		bgCanvas = document.getElementById('scenery-bg-canvas');
		if (!bgCanvas && sceneryContainer) {
			bgCanvas = document.createElement('canvas');
			bgCanvas.id = 'scenery-bg-canvas';
			bgCanvas.className = 'scenery-bg-canvas';
			sceneryContainer.appendChild(bgCanvas);
		}
		if (bgCanvas) {
			bgCtx = bgCanvas.getContext('2d');
			resizeBackgroundCanvas();
		}

		// Ensure foreground FX container is strictly hidden (NO particles in front)
		var fgContainer = document.getElementById('scenery-fg-container');
		if (fgContainer) fgContainer.style.display = 'none';
		fgCanvas = null;
		fgCtx = null;
	}

	function resizeBackgroundCanvas() {
		if (!bgCanvas) return;
		bgWidth = window.innerWidth;
		bgHeight = window.innerHeight;
		bgDpr = IS_ANDROID ? 1.0 : Math.min(window.devicePixelRatio || 1, 2.0);
		bgCanvas.width = bgWidth * bgDpr;
		bgCanvas.height = bgHeight * bgDpr;
		bgCanvas.style.width = bgWidth + 'px';
		bgCanvas.style.height = bgHeight + 'px';
		if (bgCtx) {
			bgCtx.setTransform(bgDpr, 0, 0, bgDpr, 0, 0);
		}
	}

	function resizeForegroundCanvas() {}

	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('resize', function () {
			resizeBackgroundCanvas();
		});
	}

	// --------------------------------------------------------------------------
	// HIGH-DPI PARTICLES (PASSING BEHIND THE 3D PLAYING BOARD)
	// --------------------------------------------------------------------------
	function initBackgroundParticles() {
		bgParticles = [];
		var pType = SCENERIES[currentScenery] ? SCENERIES[currentScenery].particleType : 'petal';
		if (!pType || pType === 'none') {
			if (bgCtx && bgCanvas) {
				bgCtx.clearRect(0, 0, bgWidth, bgHeight);
			}
			return;
		}

		var count = (pType === 'seagull') ? 5 : bgMaxParticles;
		for (var i = 0; i < count; i++) {
			bgParticles.push(createBackgroundParticle(pType, true));
		}
	}

	function createBackgroundParticle(pType, randomizeY) {
		var w = bgWidth || window.innerWidth;
		var h = bgHeight || window.innerHeight;

		var p = {
			type: pType,
			x: Math.random() * w,
			y: randomizeY ? (Math.random() * h) : (pType === 'ember' || pType === 'seaMote' ? h + 20 : -20),
			vx: 0,
			vy: 0,
			size: 0,
			rotX: Math.random() * Math.PI * 2,
			rotZ: Math.random() * Math.PI * 2,
			rotSpeedX: 0,
			rotSpeedZ: 0,
			alpha: 0.85,
			phase: Math.random() * Math.PI * 2,
			sparkle: 0
		};

		if (pType === 'petal') {
			// Delicate curved Poui / Cherry Blossom Petals drifting gracefully behind board
			p.size = 14 + Math.random() * 12;
			p.vx = 25 + Math.random() * 35;
			p.vy = 45 + Math.random() * 50;
			p.rotSpeedX = 1.4 + Math.random() * 2.2;
			p.rotSpeedZ = 0.8 + Math.random() * 1.5;
			p.alpha = 0.85 + Math.random() * 0.15;
		} else if (pType === 'ember') {
			p.size = 4.0 + Math.random() * 5.0;
			p.vx = (Math.random() - 0.5) * 24;
			p.vy = -(65 + Math.random() * 85);
			p.rotSpeedX = 2.0 + Math.random() * 4.0;
			p.rotSpeedZ = 1.0 + Math.random() * 3.0;
			p.alpha = 0.85 + Math.random() * 0.15;
		} else if (pType === 'snow') {
			p.size = 4.5 + Math.random() * 6.5;
			p.vx = (Math.random() - 0.5) * 20;
			p.vy = 35 + Math.random() * 45;
			p.rotSpeedX = 0.8 + Math.random() * 1.5;
			p.rotSpeedZ = 0.4 + Math.random() * 1.0;
			p.alpha = 0.75 + Math.random() * 0.25;
		} else if (pType === 'crystal') {
			p.size = 4.5 + Math.random() * 6.0;
			p.vx = (Math.random() - 0.5) * 18;
			p.vy = 30 + Math.random() * 40;
			p.rotSpeedX = 1.5 + Math.random() * 3.0;
			p.rotSpeedZ = 1.0 + Math.random() * 2.0;
			p.alpha = 0.80 + Math.random() * 0.20;
		} else if (pType === 'seagull') {
			p.size = 13 + Math.random() * 8;
			p.x = randomizeY ? (Math.random() * w) : -30;
			p.y = 0.08 * h + Math.random() * (0.24 * h);
			p.vx = 24 + Math.random() * 18;
			p.vy = (Math.random() - 0.5) * 4;
			p.wingPhase = Math.random() * Math.PI * 2;
			p.wingSpeed = 3.2 + Math.random() * 1.6;
			p.alpha = 0.82 + Math.random() * 0.16;
		} else {
			p.size = 4.0 + Math.random() * 5.5;
			p.vx = 16 + Math.random() * 26;
			p.vy = -(28 + Math.random() * 48);
			p.rotSpeedX = 1.0 + Math.random() * 2.0;
			p.rotSpeedZ = 0.5 + Math.random() * 1.5;
			p.alpha = 0.70 + Math.random() * 0.30;
		}

		return p;
	}

	var bgParticleSprites = {};
	var lastBgParticleRenderTime = 0;
	var bgCanvasClearedForPeaks = false;

	function getBgParticleSprite(type) {
		if (bgParticleSprites[type]) return bgParticleSprites[type];
		var c = document.createElement('canvas');
		c.width = 64;
		c.height = 64;
		var ctx = c.getContext('2d');
		var cx = 32, cy = 32;

		if (type === 'petal') {
			var s = 26;
			ctx.translate(cx, cy);
			ctx.beginPath();
			ctx.moveTo(0, -s * 0.6);
			ctx.bezierCurveTo(s * 0.55, -s * 0.5, s * 0.6, s * 0.3, 0, s * 0.7);
			ctx.bezierCurveTo(-s * 0.6, s * 0.3, -s * 0.55, -s * 0.5, 0, -s * 0.6);
			var pGrad = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.7);
			pGrad.addColorStop(0.0, 'rgba(255, 250, 252, 1.0)');
			pGrad.addColorStop(0.45, 'rgba(255, 185, 215, 0.95)');
			pGrad.addColorStop(1.0, 'rgba(235, 110, 160, 0.90)');
			ctx.fillStyle = pGrad;
			ctx.fill();
		} else if (type === 'ember') {
			var eGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 28);
			eGrad.addColorStop(0.0, 'rgba(255, 255, 230, 1.0)');
			eGrad.addColorStop(0.3, 'rgba(255, 160, 20, 0.9)');
			eGrad.addColorStop(0.7, 'rgba(255, 60, 0, 0.6)');
			eGrad.addColorStop(1.0, 'rgba(180, 20, 0, 0)');
			ctx.fillStyle = eGrad;
			ctx.beginPath();
			ctx.arc(cx, cy, 28, 0, Math.PI * 2);
			ctx.fill();
		} else if (type === 'snow') {
			var sGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
			sGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			sGrad.addColorStop(0.6, 'rgba(240, 248, 255, 0.8)');
			sGrad.addColorStop(1.0, 'rgba(220, 235, 255, 0)');
			ctx.fillStyle = sGrad;
			ctx.beginPath();
			ctx.arc(cx, cy, 28, 0, Math.PI * 2);
			ctx.fill();
		} else {
			var mGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 28);
			mGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			mGrad.addColorStop(0.4, 'rgba(120, 240, 235, 0.7)');
			mGrad.addColorStop(1.0, 'rgba(64, 224, 208, 0)');
			ctx.fillStyle = mGrad;
			ctx.beginPath();
			ctx.arc(cx, cy, 28, 0, Math.PI * 2);
			ctx.fill();
		}

		bgParticleSprites[type] = c;
		return c;
	}

	function updateAndRenderBackgroundParticles(dt, now) {
		if (!bgCtx || !bgCanvas || !PARTICLES_BEHIND_ENABLED) return;
		var w = bgWidth;
		var h = bgHeight;
		if (w <= 0 || h <= 0) return;

		// Skip 2D particle canvas when 3D Alpine Peaks or Tropical Pier scene is active
		if (currentScenery === 'peaks' || currentScenery === 'ocean') {
			if (!bgCanvasClearedForPeaks) {
				bgCtx.clearRect(0, 0, w, h);
				bgCanvasClearedForPeaks = true;
			}
			return;
		}
		bgCanvasClearedForPeaks = false;
		dt = Math.min(dt || 0.016, 0.05);

		bgCtx.clearRect(0, 0, w, h);

		for (var i = 0; i < bgParticles.length; i++) {
			var p = bgParticles[i];

			if (p.type === 'seagull') {
				// Seagull flight physics: smooth glide with gentle wing flaps
				p.x += p.vx * dt;
				p.y += (p.vy + Math.sin(now * 0.0018 + p.phase) * 6) * dt;
				p.wingPhase = (p.wingPhase || 0) + (p.wingSpeed || 3.2) * dt;

				if (p.x > w + 40) {
					p.x = -40;
					p.y = 0.07 * h + Math.random() * (0.23 * h);
				}

				var s = p.size;
				var flap = Math.sin(p.wingPhase);
				var wingY = flap * (s * 0.40);

				bgCtx.save();
				bgCtx.translate(p.x, p.y);

				// Crisp white curved wings with aerodynamic stroke
				bgCtx.strokeStyle = 'rgba(255, 255, 255, ' + p.alpha + ')';
				bgCtx.fillStyle = 'rgba(255, 255, 255, ' + p.alpha + ')';
				bgCtx.lineWidth = Math.max(1.6, s * 0.16);
				bgCtx.lineCap = 'round';
				bgCtx.lineJoin = 'round';

				// Left wing arched
				bgCtx.beginPath();
				bgCtx.moveTo(0, 0);
				bgCtx.quadraticCurveTo(-s * 0.42, -wingY, -s * 0.95, -wingY * 0.65);
				bgCtx.stroke();

				// Right wing arched
				bgCtx.beginPath();
				bgCtx.moveTo(0, 0);
				bgCtx.quadraticCurveTo(s * 0.42, -wingY, s * 0.95, -wingY * 0.65);
				bgCtx.stroke();

				// Body dot
				bgCtx.beginPath();
				bgCtx.arc(0, 0, s * 0.14, 0, Math.PI * 2);
				bgCtx.fill();

				// Charcoal wingtips
				bgCtx.strokeStyle = 'rgba(60, 70, 80, ' + (p.alpha * 0.85) + ')';
				bgCtx.lineWidth = Math.max(1.2, s * 0.13);
				bgCtx.beginPath();
				bgCtx.moveTo(-s * 0.75, -wingY * 0.88);
				bgCtx.lineTo(-s * 0.95, -wingY * 0.65);
				bgCtx.stroke();

				bgCtx.beginPath();
				bgCtx.moveTo(s * 0.75, -wingY * 0.88);
				bgCtx.lineTo(s * 0.95, -wingY * 0.65);
				bgCtx.stroke();

				bgCtx.restore();
				continue;
			}

			// Physical motion
			p.x += (p.vx + Math.sin(now * 0.0025 + p.phase) * 22) * dt;
			p.y += p.vy * dt;
			p.rotX += p.rotSpeedX * dt;
			p.rotZ += p.rotSpeedZ * dt;

			// Wrap boundaries
			if (p.type === 'ember' || p.type === 'seaMote') {
				if (p.y < -30) {
					p.y = h + 20;
					p.x = Math.random() * w;
				}
			} else {
				if (p.y > h + 30) {
					p.y = -20;
					p.x = Math.random() * w;
				}
			}
			if (p.x < -30) p.x = w + 20;
			if (p.x > w + 30) p.x = -20;

			bgCtx.save();
			bgCtx.translate(p.x, p.y);
			bgCtx.rotate(p.rotZ);

			var flip = Math.cos(p.rotX);
			bgCtx.scale(flip, 1);

			if (p.type === 'petal') {
				var s = p.size * 1.3;
				bgCtx.globalAlpha = p.alpha;
				bgCtx.drawImage(getBgParticleSprite('petal'), -s, -s, s * 2, s * 2);
			} else if (p.type === 'ember') {
				var r = p.size * 1.8;
				var flicker = 0.80 + Math.sin(now * 0.015 + p.phase) * 0.20;
				bgCtx.globalAlpha = p.alpha * flicker;
				bgCtx.drawImage(getBgParticleSprite('ember'), -r, -r, r * 2, r * 2);
			} else if (p.type === 'snow') {
				var rSnow = p.size;
				bgCtx.globalAlpha = p.alpha;
				bgCtx.drawImage(getBgParticleSprite('snow'), -rSnow, -rSnow, rSnow * 2, rSnow * 2);
			} else if (p.type === 'crystal') {
				var rCrys = p.size;
				var glint = Math.pow(Math.max(0, Math.sin(now * 0.005 + p.phase)), 3);
				bgCtx.globalAlpha = p.alpha * (0.6 + glint * 0.4);
				bgCtx.drawImage(getBgParticleSprite('snow'), -rCrys * 1.2, -rCrys * 1.2, rCrys * 2.4, rCrys * 2.4);
			} else {
				var rMote = p.size * 1.6;
				bgCtx.globalAlpha = p.alpha;
				bgCtx.drawImage(getBgParticleSprite('seaMote'), -rMote, -rMote, rMote * 2, rMote * 2);
			}

			bgCtx.restore();
		}

		// Occasional branch snow clumps falling from the pine trees in snowtown
		if (currentScenery === 'snowtown') {
			if (!nextBranchDropTime) {
				nextBranchDropTime = now + 1500 + Math.random() * 2500;
			}
			if (now > nextBranchDropTime) {
				nextBranchDropTime = now + 3500 + Math.random() * 3000;
				// Aspect cover fit conversion from image coords to screen coords
				var ca = w / h;
				var ia = 768 / 1376;
				var sx = 1.0, sy = 1.0;
				if (ca > ia) { sy = ia / ca; } else { sx = ca / ia; }

				var sites = [
					{ ix: 0.10, iy: 0.80, landingIy: 0.88 }, // Tree 1 left lower bough
					{ ix: 0.16, iy: 0.83, landingIy: 0.91 }, // Tree 1 right lower bough
					{ ix: 0.12, iy: 0.77, landingIy: 0.85 }, // Tree 1 mid bough
					{ ix: 0.30, iy: 0.73, landingIy: 0.81 }, // Tree 5 left bough
					{ ix: 0.34, iy: 0.75, landingIy: 0.83 }, // Tree 5 right bough
					{ ix: 0.06, iy: 0.73, landingIy: 0.81 }  // Tree 2 bough
				];
				var site = sites[Math.floor(Math.random() * sites.length)];
				var startX = ((site.ix - 0.5) / sx + 0.5) * w;
				var startY = ((site.iy - 0.5) / sy + 0.5) * h;
				var landingY = ((site.landingIy - 0.5) / sy + 0.5) * h;

				var clumpCount = 14 + Math.floor(Math.random() * 8);
				for (var k = 0; k < clumpCount; k++) {
					branchSnowDrops.push({
						x: startX + (Math.random() - 0.5) * 16,
						y: startY + (Math.random() - 0.5) * 6,
						vx: (Math.random() - 0.5) * 18 + 6,
						vy: 18 + Math.random() * 28,
						ay: 180 + Math.random() * 80,
						size: 2.8 + Math.random() * 4.2,
						alpha: 0.85 + Math.random() * 0.15,
						landingY: landingY + (Math.random() - 0.5) * 8,
						landed: false,
						fade: 1.0
					});
				}
			}

			// Update & render branch snow drops
			for (var b = branchSnowDrops.length - 1; b >= 0; b--) {
				var sp = branchSnowDrops[b];
				if (!sp.landed) {
					sp.vy += sp.ay * dt;
					sp.x += sp.vx * dt;
					sp.y += sp.vy * dt;
					if (sp.y >= sp.landingY) {
						sp.landed = true;
						sp.size *= 1.35;
					}
				} else {
					sp.fade -= dt * 2.5;
					if (sp.fade <= 0) {
						branchSnowDrops.splice(b, 1);
						continue;
					}
				}

				var curAlpha = sp.alpha * sp.fade;
				var r = sp.size;
				if (IS_ANDROID) {
					bgCtx.globalAlpha = curAlpha;
					bgCtx.drawImage(getBgParticleSprite('snow'), sp.x - r, sp.y - r, r * 2, r * 2);
				} else {
					var grad = bgCtx.createRadialGradient(sp.x, sp.y, r * 0.1, sp.x, sp.y, r);
					grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + curAlpha + ')');
					grad.addColorStop(0.5, 'rgba(240, 248, 255, ' + (curAlpha * 0.85) + ')');
					grad.addColorStop(1.0, 'rgba(220, 235, 255, 0)');
					bgCtx.fillStyle = grad;
					bgCtx.beginPath();
					bgCtx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
					bgCtx.fill();
				}
			}
		}
	}

	function initForegroundParticles() {}
	function updateAndRenderForegroundParticles() {}

	// --------------------------------------------------------------------------
	// PROCEDURAL TEXTURES FOR THREE.JS 3D IN-SCENE PARTICLES
	// --------------------------------------------------------------------------
	function createParticleTexture(type) {
		if (particleTextures[type]) return particleTextures[type];

		var size = 128;
		var canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		var ctx = canvas.getContext('2d');
		var center = size * 0.5;

		if (type === 'petal') {
			ctx.save();
			ctx.translate(center, center);
			ctx.rotate(-0.25);

			var grad = ctx.createRadialGradient(-4, -8, 4, 0, 0, 48);
			grad.addColorStop(0.0, 'rgba(255, 245, 250, 0.98)');
			grad.addColorStop(0.45, 'rgba(255, 195, 220, 0.90)');
			grad.addColorStop(0.85, 'rgba(240, 130, 175, 0.75)');
			grad.addColorStop(1.0, 'rgba(220, 90, 145, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(0, -42);
			ctx.bezierCurveTo(28, -35, 34, 18, 0, 44);
			ctx.bezierCurveTo(-34, 18, -28, -35, 0, -42);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		} else if (type === 'ember') {
			var grad = ctx.createRadialGradient(center, center, 4, center, center, 56);
			grad.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
			grad.addColorStop(0.25, 'rgba(255, 175, 30, 0.95)');
			grad.addColorStop(0.65, 'rgba(255, 55, 0, 0.65)');
			grad.addColorStop(1.0, 'rgba(180, 15, 0, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 56, 0, Math.PI * 2);
			ctx.fill();
		} else if (type === 'snow') {
			var grad = ctx.createRadialGradient(center, center, 2, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			grad.addColorStop(0.45, 'rgba(240, 248, 255, 0.85)');
			grad.addColorStop(0.85, 'rgba(215, 235, 255, 0.35)');
			grad.addColorStop(1.0, 'rgba(200, 225, 255, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 52, 0, Math.PI * 2);
			ctx.fill();
		} else if (type === 'crystal') {
			var grad = ctx.createRadialGradient(center, center, 2, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			grad.addColorStop(0.35, 'rgba(220, 240, 255, 0.90)');
			grad.addColorStop(0.75, 'rgba(160, 210, 255, 0.40)');
			grad.addColorStop(1.0, 'rgba(140, 190, 255, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(center, center - 48);
			ctx.lineTo(center + 14, center);
			ctx.lineTo(center, center + 48);
			ctx.lineTo(center - 14, center);
			ctx.closePath();
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(center - 48, center);
			ctx.lineTo(center, center + 14);
			ctx.lineTo(center + 48, center);
			ctx.lineTo(center, center - 14);
			ctx.closePath();
			ctx.fill();
		} else {
			var grad = ctx.createRadialGradient(center, center, 4, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
			grad.addColorStop(0.35, 'rgba(140, 245, 240, 0.85)');
			grad.addColorStop(0.75, 'rgba(64, 224, 208, 0.40)');
			grad.addColorStop(1.0, 'rgba(32, 178, 170, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 52, 0, Math.PI * 2);
			ctx.fill();
		}

		var tex = new THREE.CanvasTexture(canvas);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		particleTextures[type] = tex;
		return tex;
	}

	function build3DParticleSystem(type) {
		var count = 65;
		var geom = new THREE.BufferGeometry();
		var positions = new Float32Array(count * 3);
		var velocities = [];

		var tex = createParticleTexture(type);

		for (var i = 0; i < count; i++) {
			var i3 = i * 3;
			positions[i3] = (Math.random() - 0.5) * 18;
			// Height: 0.6 to 2.4 (physically in front of tiles at Y=0.48)
			positions[i3 + 1] = Math.random() * 1.8 + 0.6;
			positions[i3 + 2] = Math.random() * 24 - 13;

			var vx = 0, vy = 0, vz = 0;
			if (type === 'ember') {
				vz = -(1.8 + Math.random() * 2.4);
				vx = (Math.random() - 0.5) * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'petal') {
				vz = 1.2 + Math.random() * 1.8;
				vx = 0.5 + Math.random() * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'snow') {
				vz = 1.0 + Math.random() * 1.5;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else if (type === 'crystal') {
				vz = 0.8 + Math.random() * 1.4;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else {
				vz = -(0.8 + Math.random() * 1.4);
				vx = 0.4 + Math.random() * 0.7;
				vy = (Math.random() - 0.5) * 0.3;
			}

			velocities.push({
				vx: vx, vy: vy, vz: vz,
				phase: Math.random() * Math.PI * 2,
				speed: 1.0 + Math.random() * 2.0
			});
		}

		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		var size = (type === 'petal') ? 0.90 : ((type === 'ember') ? 0.82 : ((type === 'snow') ? 0.76 : 0.72));
		var mat = new THREE.PointsMaterial({
			size: size,
			map: tex,
			transparent: true,
			opacity: 0.88,
			blending: (type === 'ember' || type === 'crystal' || type === 'seaMote') ? THREE.AdditiveBlending : THREE.NormalBlending,
			depthWrite: false,
			fog: false
		});

		var pSystem = new THREE.Points(geom, mat);
		pSystem.name = 'Particles3D_' + type;
		pSystem.userData = {
			velocities: velocities,
			type: type
		};

		return pSystem;
	}

	// --------------------------------------------------------------------------
	// INITIALIZATION & SCENERY SWITCHING
	// --------------------------------------------------------------------------
	function init(scene, camera, renderer) {
		sceneRef = scene;
		cameraRef = camera;
		rendererRef = renderer;

		ensureDOMContainers();

		// Add dynamic point light for authentic environmental illumination
		if (!dynamicPointLight && sceneRef) {
			dynamicPointLight = new THREE.PointLight(0xfffaed, 1.4, 35);
			dynamicPointLight.position.set(0, 3.5, -1.0);
			sceneRef.add(dynamicPointLight);
		}

		// Build 3D particle systems in Three.js (disabled: nothing floats in front of the board)
		// 3D in-scene particles in front of board are disabled; particles live strictly in the background layer
		if (false) {
			particleSystems3D.sakura = build3DParticleSystem('petal');
			particleSystems3D.volcano = build3DParticleSystem('ember');
			particleSystems3D.snowtown = build3DParticleSystem('snow');
			particleSystems3D.peaks = build3DParticleSystem('crystal');
			particleSystems3D.ocean = build3DParticleSystem('seaMote');
		}

		Object.keys(particleSystems3D).forEach(function (key) {
			var ps = particleSystems3D[key];
			ps.visible = false;
			if (sceneRef) sceneRef.add(ps);
		});

		// Restore saved scenery preference or default to sakura
		var saved = null;
		try {
			saved = localStorage.getItem('word_chain_scenery');
		} catch (e) {}

		setScenery(saved && SCENERIES[saved] ? saved : 'sakura');
	}

	function setScenery(id) {
		if (!SCENERIES[id]) id = 'sakura';
		var scId = SCENERIES[id].id;
		currentScenery = scId;
		branchSnowDrops = [];
		nextBranchDropTime = 0;

		try {
			localStorage.setItem('word_chain_scenery', scId);
		} catch (e) {}

		// 1. Update DOM Photo Plates (Silky Smooth 1s Cross-Fade; 'peaks', 'ocean' and 'volcano' use real-time Three.js 3D scenes instead of photo plates)
		SCENERY_CYCLE_ORDER.forEach(function (key) {
			var plate = document.getElementById('scenery-plate-' + key);
			if (plate) {
				if (key === scId && scId !== 'peaks' && scId !== 'ocean' && scId !== 'volcano') {
					plate.classList.add('active');
				} else {
					plate.classList.remove('active');
				}
			}
		});

		// 2. Update Photographic Vignette
		var vignette = document.getElementById('scenery-vignette');
		if (vignette) {
			vignette.className = 'scenery-vignette ' + SCENERIES[scId].vignetteClass;
		}

		// 3. Update Ambient Glow (live scenes and 3D scenes light themselves)
		var glow = document.getElementById('scenery-ambient-glow');
		if (glow) {
			glow.className = 'scenery-ambient-glow' + ((LIVE_SCENES[scId] || scId === 'peaks' || scId === 'ocean' || scId === 'volcano') ? '' : ' ' + SCENERIES[scId].glowClass);
		}

		// 3b. Live animated backdrop (WebGL) for supported 2D shader scenes
		liveSetScene(scId);

		// 3c. Real-Time Three.js 3D Alpine Ski Resort Scene for 'peaks'
		peaks3DSetActive(scId === 'peaks');

		// 3d. Real-Time Three.js 3D Tropical Pier Scene for 'ocean'
		if (typeof ocean3DSetActive === 'function') {
			ocean3DSetActive(scId === 'ocean');
		}

		// 3e. Real-Time Three.js 3D Volcano Night Scene for 'volcano'
		if (typeof volcano3DSetActive === 'function') {
			volcano3DSetActive(scId === 'volcano');
		}

		// 4. Update Three.js 3D Lighting
		applyLighting(scId);

		// 5. Update 3D In-Scene Particle System
		Object.keys(particleSystems3D).forEach(function (key) {
			var ps = particleSystems3D[key];
			if (ps) ps.visible = (key === scId);
		});
		activeParticles3D = particleSystems3D[scId];

		// 6. Reset Background High-DPI Particles (Passing BEHIND the board)
		if (PARTICLES_BEHIND_ENABLED) initBackgroundParticles();

		// 7. Update 3D tray theme (switching to Burnt Charcoal on volcano, and restoring fine hardwood on other scenes)
		if (global.TextureManager && typeof global.TextureManager.updateTrayTheme === 'function') {
			try { global.TextureManager.updateTrayTheme(); } catch (e) {}
		}
	}

	function applyLighting(scId) {
		var sc = SCENERIES[scId];
		if (!sc || !sc.lighting) return;

		// Update scene ambient, directional, and fill lights
		if (sceneRef && sceneRef.userData && sceneRef.userData.lights) {
			var lights = sceneRef.userData.lights;
			if (lights.ambient && sc.lighting.ambient) {
				lights.ambient.color.setHex(sc.lighting.ambient.color);
				lights.ambient.intensity = sc.lighting.ambient.intensity;
			}
			if (lights.sun && sc.lighting.sun) {
				lights.sun.color.setHex(sc.lighting.sun.color);
				lights.sun.intensity = sc.lighting.sun.intensity;
				if (sc.lighting.sun.pos) {
					lights.sun.position.set(sc.lighting.sun.pos[0], sc.lighting.sun.pos[1], sc.lighting.sun.pos[2]);
				}
			}
			if (lights.fill && sc.lighting.fill) {
				lights.fill.color.setHex(sc.lighting.fill.color);
				lights.fill.intensity = sc.lighting.fill.intensity;
			}
		}

		// Update dynamic environmental point light
		if (dynamicPointLight && sc.lighting.point) {
			dynamicPointLight.color.setHex(sc.lighting.point.color);
			dynamicPointLight.intensity = sc.lighting.point.intensity;
			if (sc.lighting.point.pos) {
				dynamicPointLight.position.set(sc.lighting.point.pos[0], sc.lighting.point.pos[1], sc.lighting.point.pos[2]);
			}
		}

		// Scene background must stay null so the authentic living landscape shows through transparent WebGL
		if (sceneRef) {
			sceneRef.background = null;
			sceneRef.fog = null;
		}
	}

	function setSceneryForLevel(levelIndex) {
		var idx = Math.floor(levelIndex / 5) % SCENERY_CYCLE_ORDER.length;
		setScenery(SCENERY_CYCLE_ORDER[idx]);
	}

	// --------------------------------------------------------------------------
	// ANIMATION LOOP (LOCKED 60 FPS, ZERO ALLOCATIONS)
	// --------------------------------------------------------------------------
	function update(dt, now) {
		dt = Math.min(dt || 0.016, 0.05);

		// 0. Living backdrop (self-throttled to ~30fps) & Real-Time Three.js 3D Alpine Ski Resort, Tropical Pier & Volcano Night
		liveUpdate();
		if (currentScenery === 'peaks') {
			peaks3DUpdate(dt, now);
		} else if (currentScenery === 'ocean' && typeof ocean3DUpdate === 'function') {
			ocean3DUpdate(dt, now);
		} else if (currentScenery === 'volcano' && typeof volcano3DUpdate === 'function') {
			volcano3DUpdate(dt, now);
		}

		// 1. Update & Render Background Particles (BEHIND the 3D board)
		if (PARTICLES_BEHIND_ENABLED) updateAndRenderBackgroundParticles(dt, now);

		// 2. Update 3D In-Scene Particles
		if (activeParticles3D && activeParticles3D.visible) {
			var geom = activeParticles3D.geometry;
			var posAttr = geom.getAttribute('position');
			var pos = posAttr.array;
			var vels = activeParticles3D.userData.velocities;
			var pType = activeParticles3D.userData.type;

			for (var i = 0; i < vels.length; i++) {
				var i3 = i * 3;
				var v = vels[i];

				pos[i3] += v.vx * dt;
				pos[i3 + 1] += v.vy * dt;
				pos[i3 + 2] += v.vz * dt;

				pos[i3] += Math.sin(now * 0.002 * v.speed + v.phase) * 0.012;

				if (pType === 'ember' || pType === 'seaMote') {
					if (pos[i3 + 2] < -13.0) {
						pos[i3 + 2] = 11.5;
						pos[i3] = (Math.random() - 0.5) * 18;
					}
				} else {
					if (pos[i3 + 2] > 11.5) {
						pos[i3 + 2] = -13.0;
						pos[i3] = (Math.random() - 0.5) * 18;
					}
				}

				if (pos[i3] > 10.0) pos[i3] = -10.0;
				if (pos[i3] < -10.0) pos[i3] = 10.0;
				if (pos[i3 + 1] > 2.8) pos[i3 + 1] = 0.6;
				if (pos[i3 + 1] < 0.4) pos[i3 + 1] = 2.2;
			}
			posAttr.needsUpdate = true;
		}

		// 3. Living Light Convection FX
		if (dynamicPointLight) {
			if (currentScenery === 'volcano') {
				// Gentle caldera heat convection breathing (soft warm amber, zero blinding red glare)
				dynamicPointLight.intensity = 0.85 + Math.sin(now * 0.005) * 0.12;
			} else if (currentScenery === 'snowtown') {
				// Gentle chalet lantern glimmer
				dynamicPointLight.intensity = 1.8 + Math.sin(now * 0.004) * 0.28;
			} else if (currentScenery === 'ocean') {
				// Calm, natural sunlight fill (rock-solid, zero fake neon flicker)
				dynamicPointLight.intensity = 0.30;
			}
		}
	}

	function onCameraUpdate() {
		// Scenery plates are responsive cover plates in DOM, ensuring 100% full screen coverage
	}

	function getCurrent() {
		return currentScenery;
	}

	function getSceneries() {
		return SCENERIES;
	}

	function toggleForeground() {}

	// Auto-initialize DOM containers on DOM ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', ensureDOMContainers);
	} else {
		ensureDOMContainers();
	}

	// Export API
	global.WordscapesScenery = {
		init: init,
		update: update,
		renderBackgroundPass: renderBackgroundPass,
		setScenery: setScenery,
		setSceneryForLevel: setSceneryForLevel,
		applyLighting: applyLighting,
		onCameraUpdate: onCameraUpdate,
		getCurrent: getCurrent,
		getSceneries: getSceneries,
		toggleForeground: toggleForeground
	};

})(window);
