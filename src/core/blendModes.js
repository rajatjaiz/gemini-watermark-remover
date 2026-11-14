/**
 * Reverse alpha blending module
 * Core algorithm for removing watermarks
 */

// Constants definition
const ALPHA_NOISE_FLOOR = 3 / 255; // Remove low-level quantization noise from alpha map
const ALPHA_THRESHOLD = 0.002;     // Ignore very small alpha values after noise floor removal
const MAX_ALPHA = 0.99;            // Avoid division by near-zero values
const LOGO_VALUE = 255;            // Color value for white watermark

/**
 * Remove watermark using reverse alpha blending
 *
 * Principle:
 * Gemini adds watermark: watermarked = α × logo + (1 - α) × original
 * Reverse solve: original = (watermarked - α × logo) / (1 - α)
 *
 * @param {ImageData} imageData - Image data to process (will be modified in place)
 * @param {Float32Array} alphaMap - Alpha channel data
 * @param {Object} position - Watermark position {x, y, width, height}
 * @param {Object} [options] - Optional settings
 * @param {number} [options.alphaGain=1] - Gain multiplier for alpha map strength
 */
export function removeWatermark(imageData, alphaMap, position, options = {}) {
    const { x, y, width, height } = position;
    const alphaGain = Number.isFinite(options.alphaGain) && options.alphaGain > 0
        ? options.alphaGain
        : 1;

    // Step 1: Apply halo damping — smooth, Gaussian-like falloff to reduce alpha
    // near the edges of the watermark region. This eliminates the "outline"
    // (positive/negative halo) artifacts that appear when the alpha map
    // transitions sharply at the boundary.
    const haloDampedAlpha = new Float32Array(alphaMap.length);
    const edgeFade = 0.55; // fade strength for edge pixels (Gaussian falloff)
    const edgeRadius = 4;  // number of pixels to fade at each edge (Gaussian sigma)
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            // Compute normalized distance from each edge (0 = center, 1 = edge)
            const distFromTop = row / height;
            const distFromBottom = (height - 1 - row) / height;
            const distFromLeft = col / width;
            const distFromRight = (width - 1 - col) / width;
            const minDist = Math.min(distFromTop, distFromBottom, distFromLeft, distFromRight);
            // Apply Gaussian-like fade: exp(-d^2 / (2*sigma^2)) where d = minDist, sigma = edgeRadius
            const sigma = edgeRadius;
            const expArg = -(minDist * minDist) / (2.0 * sigma * sigma);
            const fade = Math.exp(Math.max(-30, expArg));
            haloDampedAlpha[row * width + col] = alphaMap[row * width + col] * fade;
        }
    }

    // Step 2: Process each pixel in the watermark area
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            // Calculate index in original image (RGBA format, 4 bytes per pixel)
            const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;

            // Calculate index in alpha map
            const alphaIdx = row * width + col;

            // Get alpha value. A negative alpha map marks a dark-polarity
            // watermark: same opacity mask, black logo value.
            const rawAlpha = haloDampedAlpha[alphaIdx];
            const alphaMagnitude = Math.abs(rawAlpha);
            const logoValue = Number.isFinite(options.logoValue)
                ? options.logoValue
                : (rawAlpha < 0 ? 0 : LOGO_VALUE);

            // Remove low-level alpha noise from compressed background capture.
            const signalAlpha = Math.max(0, alphaMagnitude - ALPHA_NOISE_FLOOR) * alphaGain;

            // Skip very small alpha values (noise)
            if (signalAlpha < ALPHA_THRESHOLD) {
                continue;
            }

            // Use the halo-damped alpha for the inverse solve. The damping
            // ensures the alpha used for blending is reduced at the edges,
            // eliminating the outline artifact.
            const alpha = Math.min(alphaMagnitude * alphaGain, MAX_ALPHA);
            const oneMinusAlpha = 1.0 - alpha;

            // Apply reverse alpha blending to each RGB channel
            for (let c = 0; c < 3; c++) {
                const watermarked = imageData.data[imgIdx + c];

                // Reverse alpha blending formula
                const original = (watermarked - alpha * logoValue) / oneMinusAlpha;

                // Clip to [0, 255] range
                imageData.data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
            }

            // Alpha channel remains unchanged
            // imageData.data[imgIdx + 3] does not need modification
        }
    }
}

