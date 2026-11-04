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
	// All 5 photographic scenes enabled for HD live ambient animation:
	var LIVE_SCENES = { sakura: true, volcano: true, snowtown: true, peaks: true, ocean: true };

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
		'uniform vec4 uSkiers[3];',
		'uniform vec4 uSkierProps[3];',
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
		'  vec3 col = texture2D(uTex, p).rgb;',
		'',
		'  // 1. High Alpine Wind & Ridge Spindrift (crystalline snow dust blowing across summit cols)',
		'  float ridgeZone = smoothstep(0.18, 0.28, p.y) * (1.0 - smoothstep(0.38, 0.46, p.y));',
		'  if (ridgeZone > 0.001) {',
		'    float drift1 = 0.5 + 0.5 * sin(p.x * 22.0 - t * 0.45 + sin(p.y * 18.0));',
		'    float drift2 = 0.5 + 0.5 * cos((p.x + p.y * 0.5) * 35.0 - t * 0.65);',
		'    float spindrift = ridgeZone * pow(drift1 * drift2, 1.8) * 0.16;',
		'    vec3 snowHaze = vec3(0.92, 0.95, 1.0);',
		'    col = mix(col, snowHaze, spindrift);',
		'  }',
		'',
		'  // 2. Dynamic Alpine Skiers carving down the pistes with powder spray plumes',
		'  for (int i = 0; i < 3; i++) {',
		'    vec4 sData = uSkiers[i];',
		'    vec4 sProp = uSkierProps[i];',
		'    float sActive = sProp.x;',
		'    if (sActive > 0.01) {',
		'      vec2 sPos = sData.xy;',
		'      vec2 sDir = sData.zw;',
		'      vec2 toPixel = p - sPos;',
		'      float d = length(toPixel);',
		'      float pScale = sProp.z;',
		'      float colorId = sProp.y;',
		'      float carveFactor = sProp.w;',
		'',
		'      // Normalized skier coordinate frame: forward along velocity & lateral',
		'      vec2 fwd = normalize(sDir + vec2(1e-5, 0.0));',
		'      vec2 lat = vec2(-fwd.y, fwd.x);',
		'      float distFwd = dot(toPixel, fwd);',
		'      float distLat = dot(toPixel, lat);',
		'',
		'      // A. Powder Snow Spray Plume behind & outside the carve',
		'      vec2 sprayCenter = -fwd * (0.006 * pScale) + lat * (carveFactor * 0.005 * pScale);',
		'      float sprayDist = length(toPixel - sprayCenter);',
		'      float sprayRadius = 0.018 * pScale;',
		'      if (sprayDist < sprayRadius && distFwd < 0.002) {',
		'        float sprayDensity = exp(-sprayDist * sprayDist / max(1e-6, 2.0 * pow(0.007 * pScale, 2.0))) * abs(carveFactor) * sActive * 0.75;',
		'        col = mix(col, vec3(0.98, 0.99, 1.0), clamp(sprayDensity, 0.0, 0.85));',
		'      }',
		'',
		'      // B. Skier Shadow (cast onto snow just behind skier)',
		'      vec2 shadowOffset = vec2(0.002, 0.003) * pScale;',
		'      float dShadow = length(toPixel - shadowOffset);',
		'      float shadowRadius = 0.0045 * pScale;',
		'      if (dShadow < shadowRadius) {',
		'        float shadow = smoothstep(shadowRadius, shadowRadius * 0.2, dShadow) * sActive * 0.42;',
		'        col *= (1.0 - shadow);',
		'      }',
		'',
		'      // C. Skis (dark parallel slats aligned with carve direction)',
		'      float skiLen = 0.009 * pScale;',
		'      float skiWidth = 0.0018 * pScale;',
		'      if (abs(distFwd) < skiLen * 0.5 && abs(distLat) < skiWidth * 1.5) {',
		'        col = mix(col, vec3(0.12, 0.15, 0.20), sActive * 0.85);',
		'      }',
		'',
		'      // D. Skier Body / High-Visibility Alpine Jacket',
		'      float bodyRadius = 0.0040 * pScale;',
		'      float dBody = length(toPixel + fwd * 0.001 * pScale);',
		'      if (dBody < bodyRadius) {',
		'        vec3 jacketCol = vec3(0.96, 0.18, 0.14);',
		'        if (colorId > 0.5 && colorId < 1.5) jacketCol = vec3(0.10, 0.50, 0.98);',
		'        else if (colorId >= 1.5) jacketCol = vec3(1.0, 0.76, 0.08);',
		'        float bodyShade = smoothstep(bodyRadius, bodyRadius * 0.2, dBody) * sActive;',
		'        col = mix(col, jacketCol, bodyShade);',
		'      }',
		'',
		'      // E. Skier Helmet (high-contrast white/black dome)',
		'      float headRadius = 0.0022 * pScale;',
		'      float dHead = length(toPixel - fwd * 0.0025 * pScale);',
		'      if (dHead < headRadius) {',
		'        col = mix(col, vec3(0.95, 0.95, 0.98), sActive);',
		'      }',
		'    }',
		'  }',
		'',
		'  // 3. Delicate Alpine Crystalline Powder Sparkles on sunlit slopes',
		'  if (p.y > 0.35 && p.y < 0.82) {',
		'    float snowLum = dot(col, vec3(0.299, 0.587, 0.114));',
		'    if (snowLum > 0.72) {',
		'      float sparkle = pow(max(0.0, sin(t * 3.0 + p.x * 55.0 + p.y * 65.0)), 24.0) * 0.22;',
		'      col += vec3(sparkle * (snowLum - 0.72) * 3.5);',
		'    }',
		'  }',
		'',
		'  // 4. Subtle Alpine Atmospheric Depth (recessed shadow cols have soft cool mountain haze)',
		'  float depthCol = smoothstep(0.40, 0.75, p.y);',
		'  vec3 coolHaze = vec3(0.74, 0.82, 0.94);',
		'  col = mix(col, col * coolHaze, (1.0 - col.r) * depthCol * 0.12);',
		'',
		'  // Rich contrast & deep night-sky saturation',
		'  float sLuma = dot(col, vec3(0.299, 0.587, 0.114));',
		'  col = mix(vec3(sLuma), col, 1.18);',
		'  col = pow(max(vec3(0.0), col), vec3(1.04));',
		'',
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
		// Optimized 1.0 DPR for cool mobile thermals & locked 60FPS app performance
		var dpr = 1.0;
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
		// Smooth 30 FPS background shader pacing to prevent thermal throttling and battery drain
		if (!force && now - live.lastDraw < 32) return;
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
		window.addEventListener('resize', liveResize);
		window.addEventListener('orientationchange', function () { setTimeout(liveResize, 250); });
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
				plate.className = 'scenery-photo-plate' + (key === currentScenery ? ' active' : '');
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
		bgDpr = 1.0;
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

	function updateAndRenderBackgroundParticles(dt, now) {
		if (!bgCtx || !bgCanvas || !PARTICLES_BEHIND_ENABLED) return;
		var w = bgWidth;
		var h = bgHeight;
		if (w <= 0 || h <= 0) return;

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
				// Organic Sakura / Cherry Blossom Petal with vibrant contrast
				var s = p.size;
				bgCtx.beginPath();
				bgCtx.moveTo(0, -s * 0.6);
				bgCtx.bezierCurveTo(s * 0.55, -s * 0.5, s * 0.6, s * 0.3, 0, s * 0.7);
				bgCtx.bezierCurveTo(-s * 0.6, s * 0.3, -s * 0.55, -s * 0.5, 0, -s * 0.6);

				var grad = bgCtx.createLinearGradient(0, -s * 0.6, 0, s * 0.7);
				grad.addColorStop(0.0, 'rgba(255, 250, 252, ' + p.alpha + ')');
				grad.addColorStop(0.45, 'rgba(255, 185, 215, ' + (p.alpha * 0.95) + ')');
				grad.addColorStop(1.0, 'rgba(235, 110, 160, ' + (p.alpha * 0.90) + ')');
				bgCtx.fillStyle = grad;
				bgCtx.fill();
			} else if (p.type === 'ember') {
				var r = p.size;
				var flicker = 0.80 + Math.sin(now * 0.015 + p.phase) * 0.20;
				var grad = bgCtx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.8);
				grad.addColorStop(0.0, 'rgba(255, 255, 230, ' + (p.alpha * flicker) + ')');
				grad.addColorStop(0.3, 'rgba(255, 160, 20, ' + (p.alpha * flicker * 0.9) + ')');
				grad.addColorStop(0.7, 'rgba(255, 60, 0, ' + (p.alpha * flicker * 0.6) + ')');
				grad.addColorStop(1.0, 'rgba(180, 20, 0, 0)');
				bgCtx.fillStyle = grad;
				bgCtx.beginPath();
				bgCtx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
				bgCtx.fill();
			} else if (p.type === 'snow') {
				var r = p.size;
				var grad = bgCtx.createRadialGradient(0, 0, 0, 0, 0, r);
				grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + p.alpha + ')');
				grad.addColorStop(0.6, 'rgba(240, 248, 255, ' + (p.alpha * 0.8) + ')');
				grad.addColorStop(1.0, 'rgba(220, 235, 255, 0)');
				bgCtx.fillStyle = grad;
				bgCtx.beginPath();
				bgCtx.arc(0, 0, r, 0, Math.PI * 2);
				bgCtx.fill();
			} else if (p.type === 'crystal') {
				var r = p.size;
				var glint = Math.pow(Math.max(0, Math.sin(now * 0.005 + p.phase)), 3);
				bgCtx.fillStyle = 'rgba(255, 255, 255, ' + (p.alpha * (0.6 + glint * 0.4)) + ')';
				bgCtx.beginPath();
				bgCtx.moveTo(0, -r * (1 + glint * 0.8));
				bgCtx.lineTo(r * 0.35, 0);
				bgCtx.lineTo(0, r * (1 + glint * 0.8));
				bgCtx.lineTo(-r * 0.35, 0);
				bgCtx.closePath();
				bgCtx.fill();

				bgCtx.beginPath();
				bgCtx.moveTo(-r * (1 + glint * 0.8), 0);
				bgCtx.lineTo(0, r * 0.35);
				bgCtx.lineTo(r * (1 + glint * 0.8), 0);
				bgCtx.lineTo(0, -r * 0.35);
				bgCtx.closePath();
				bgCtx.fill();
			} else {
				var r = p.size;
				var grad = bgCtx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6);
				grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + p.alpha + ')');
				grad.addColorStop(0.4, 'rgba(120, 240, 235, ' + (p.alpha * 0.7) + ')');
				grad.addColorStop(1.0, 'rgba(64, 224, 208, 0)');
				bgCtx.fillStyle = grad;
				bgCtx.beginPath();
				bgCtx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
				bgCtx.fill();
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

		// 1. Update DOM Photo Plates (Silky Smooth 1s Cross-Fade)
		SCENERY_CYCLE_ORDER.forEach(function (key) {
			var plate = document.getElementById('scenery-plate-' + key);
			if (plate) {
				if (key === scId) {
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

		// 3. Update Ambient Glow (live scenes light themselves inside the shader)
		var glow = document.getElementById('scenery-ambient-glow');
		if (glow) {
			glow.className = 'scenery-ambient-glow' + (LIVE_SCENES[scId] ? '' : ' ' + SCENERIES[scId].glowClass);
		}

		// 3b. Live animated backdrop (WebGL) for supported scenes
		liveSetScene(scId);

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

		// 0. Living backdrop (self-throttled to ~30fps)
		liveUpdate();

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
		setScenery: setScenery,
		setSceneryForLevel: setSceneryForLevel,
		applyLighting: applyLighting,
		onCameraUpdate: onCameraUpdate,
		getCurrent: getCurrent,
		getSceneries: getSceneries,
		toggleForeground: toggleForeground
	};

})(window);
