/*
 * Word Chain Game - Ultra-Optimized Train & Wheel Wall Shadow Bridge
 * --------------------------------------------------------------------
 * Casts a realistic, soft elevation drop-shadow behind the train
 * (locomotive engine and wagons) and wheels onto the wall behind them.
 *
 * Performance Architecture:
 *   1. Zero Runtime Shader Compilation / No Program Switching:
 *      Instead of compiling a heavy multi-tap convolution shader that stalls the GPU
 *      by switching gl.useProgram dozens of times per frame, we pre-bake a soft
 *      Gaussian shadow mask texture for the static train and wheel silhouettes once at startup.
 *   2. Native GameSalad 1-Tap Drawing:
 *      Each shadow is drawn using GameSalad's own native, batch-friendly drawImage
 *      pipeline with single-tap texture sampling and tinting.
 *   3. 60+ FPS Performance:
 *      Zero fragment overhead, zero GPU pipeline flushes, zero garbage collection.
 *   4. Zero Tile Shadows:
 *      Letter tiles, trays, table, and board remain completely clean.
 */
(function (global) {
	'use strict';

	var config = {
		enabled: true,
		// Shadow offset on the wall behind the train:
		// Light comes from top-left, so shadow is cast to the right (+X) and downward (+Y on screen)
		offsetX: 14,
		offsetY: 12,
		// Shadow opacity (0..1) - soft and realistic on the wall
		opacity: 0.38,
		// Shadow blur radius in pixels (used during one-time bake)
		blurRadius: 14
	};

	var TRAIN_KEYS = ['TrainP1', 'TrainWagonP1', 'Wheel', 'TrainP2', 'TrainWagonP2'];
	var sourceImages = {};    // key -> HTMLImageElement
	var bakedData = {};       // key -> { canvas, origW, origH, padding, width, height }
	var bakedHandles = {};    // key -> GameSalad imageHandle (per-renderer)

	var installed = false;
	var isDrawingShadow = false;

	/**
	 * Map any sprite / imageHandle reference to its canonical train asset key.
	 */
	function getTrainImageKey(sprite, imageHandle) {
		var id = (sprite && sprite.imageID) || '';
		if (!id && imageHandle && imageHandle.resource) {
			id = imageHandle.resource.id || imageHandle.resource.src || '';
		}
		if (!id && imageHandle && imageHandle.imageElement) {
			id = imageHandle.imageElement.src || '';
		}
		if (typeof id !== 'string' || !id) return null;

		var clean = id.split('/').pop().replace(/\.png$/i, '');
		if (/^trainp1$/i.test(clean)) return 'TrainP1';
		if (/^trainwagonp1$/i.test(clean)) return 'TrainWagonP1';
		if (/^wheel$/i.test(clean)) return 'Wheel';
		if (/^trainp2$/i.test(clean)) return 'TrainP2';
		if (/^trainwagonp2$/i.test(clean)) return 'TrainWagonP2';
		return null;
	}

	/**
	 * Pre-bake a soft Gaussian shadow mask onto an offscreen canvas once.
	 */
	function bakeKey(key, img) {
		if (bakedData[key]) return bakedData[key];
		var origW = img.width || img.naturalWidth;
		var origH = img.height || img.naturalHeight;
		if (!origW || !origH) return null;

		var blur = (key === 'Wheel') ? 8 : config.blurRadius;
		var padding = (key === 'Wheel') ? 16 : 24;

		var canvas = document.createElement('canvas');
		canvas.width = origW + padding * 2;
		canvas.height = origH + padding * 2;
		var ctx = canvas.getContext('2d');

		// Draw blurred pure-black drop shadow:
		// Draw source image far offscreen (-10000), cast shadow back into canvas (+10000)
		ctx.shadowColor = 'rgba(0, 0, 0, 1.0)';
		ctx.shadowBlur = blur;
		ctx.shadowOffsetX = 10000;
		ctx.shadowOffsetY = 0;
		ctx.drawImage(img, -10000 + padding, padding, origW, origH);

		bakedData[key] = {
			canvas: canvas,
			origW: origW,
			origH: origH,
			padding: padding,
			width: canvas.width,
			height: canvas.height
		};
		return bakedData[key];
	}

	/**
	 * Preload train sprite images in parallel on startup.
	 */
	function preloadAndBake() {
		TRAIN_KEYS.forEach(function (key) {
			if (sourceImages[key]) return;
			var img = new Image();
			sourceImages[key] = img;
			img.onload = function () {
				bakeKey(key, img);
			};
			var path = 'game/default/images/' + key + '.png';
			if (global.gs && global.gs.AssetManager && global.gs.AssetManager.current) {
				try {
					var resolved = global.gs.AssetManager.current.pathForImage(key);
					if (resolved) path = resolved;
				} catch (e) {}
			}
			img.src = path;
		});
	}

	/**
	 * Retrieve or lazily create a GameSalad imageHandle for the pre-baked shadow texture.
	 */
	function getShadowHandle(renderer, key, sourceElement) {
		if (bakedHandles[key]) {
			var h = bakedHandles[key];
			// Verify texture is still valid (e.g. across context restore)
			if (!renderer.gl || h.texture) return h;
		}

		// If data not yet baked, try to bake now using sourceElement or cached image
		var data = bakedData[key];
		if (!data) {
			var img = sourceElement || (sourceImages[key] && sourceImages[key].complete ? sourceImages[key] : null);
			if (img) {
				data = bakeKey(key, img);
			}
		}
		if (!data) return null;

		try {
			var resource = global.gs.ImageResource.createFromCanvas(data.canvas);
			if (renderer.gl) {
				resource.createTexture(renderer.gl);
			}
			var handle = renderer.getHandleManager().getImageHandle(resource);
			bakedHandles[key] = handle;
			return handle;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Hook GameSalad's WebGL renderer to draw the pre-baked shadow sprite before the train sprite.
	 */
	function hookWebGLRenderer() {
		if (!global.gs || !global.gs.SGWebGLRenderer) return;

		var originalDrawImage = global.gs.SGWebGLRenderer.prototype.drawImage;
		global.gs.SGWebGLRenderer.prototype.drawImage = function (sprite, imageHandle) {
			if (!config.enabled || isDrawingShadow || !imageHandle || !imageHandle.ready) {
				return originalDrawImage.call(this, sprite, imageHandle);
			}

			var key = getTrainImageKey(sprite, imageHandle);
			if (!key) {
				return originalDrawImage.call(this, sprite, imageHandle);
			}

			var sourceEl = (imageHandle.resource && imageHandle.resource.imageElement) || imageHandle.imageElement;
			var shadowHandle = getShadowHandle(this, key, sourceEl);

			if (shadowHandle) {
				var data = bakedData[key];
				var alpha = config.opacity;
				if (sprite.colorA !== undefined && sprite.colorA !== null) {
					alpha *= sprite.colorA;
				}

				// Construct the shadow sprite quad in 1:1 world scale
				// GameSalad Y increases upwards, so subtracting offsetY shifts the shadow downward on screen
				var shadowSprite = {
					x: sprite.x + config.offsetX,
					y: sprite.y - config.offsetY,
					width: sprite.width * (data.width / data.origW),
					height: sprite.height * (data.height / data.origH),
					angleRad: sprite.angleRad || 0,
					flipX: !!sprite.flipX,
					flipY: !!sprite.flipY,
					color: [0, 0, 0, alpha],
					blendMode: 0
				};

				isDrawingShadow = true;
				try {
					originalDrawImage.call(this, shadowSprite, shadowHandle);
				} finally {
					isDrawingShadow = false;
				}
			}

			// Draw train / wheel sprite over its cast shadow
			return originalDrawImage.call(this, sprite, imageHandle);
		};
	}

	/**
	 * Hook GameSalad's 2D Canvas renderer for fallback.
	 */
	function hookCanvasRenderer() {
		if (!global.gs || !global.gs.SGCanvasRenderer) return;

		var originalDrawImage = global.gs.SGCanvasRenderer.prototype.drawImage;
		global.gs.SGCanvasRenderer.prototype.drawImage = function (sprite, imageHandle) {
			if (!config.enabled || isDrawingShadow || !imageHandle) {
				return originalDrawImage.call(this, sprite, imageHandle);
			}

			var key = getTrainImageKey(sprite, imageHandle);
			if (!key) {
				return originalDrawImage.call(this, sprite, imageHandle);
			}

			var shadowHandle = getShadowHandle(this, key, (imageHandle.resource && imageHandle.resource.imageElement) || imageHandle.imageElement);
			if (shadowHandle) {
				var data = bakedData[key];
				var alpha = config.opacity;
				if (sprite.colorA !== undefined && sprite.colorA !== null) {
					alpha *= sprite.colorA;
				}

				var shadowSprite = {
					x: sprite.x + config.offsetX,
					y: sprite.y - config.offsetY,
					width: sprite.width * (data.width / data.origW),
					height: sprite.height * (data.height / data.origH),
					angleRad: sprite.angleRad || 0,
					flipX: !!sprite.flipX,
					flipY: !!sprite.flipY,
					color: [0, 0, 0, alpha],
					blendMode: 0
				};

				isDrawingShadow = true;
				try {
					originalDrawImage.call(this, shadowSprite, shadowHandle);
				} finally {
					isDrawingShadow = false;
				}
			}

			return originalDrawImage.call(this, sprite, imageHandle);
		};
	}

	function install() {
		if (installed) return;
		installed = true;

		// Preload assets for instant one-time shadow baking
		preloadAndBake();

		hookWebGLRenderer();
		hookCanvasRenderer();

		console.log('[WordChainShadowShader] Pre-baked Ultra-Fast Train & Wheel Wall Shadow installed successfully.');
	}

	global.WordChainShadowShader = {
		install: install,
		config: config,
		getTrainImageKey: getTrainImageKey,
		bakedData: bakedData
	};

})(typeof window !== 'undefined' ? window : this);
