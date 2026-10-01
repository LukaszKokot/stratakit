/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/

import {
	getOwnerDocument,
	getWindow,
	isBrowser,
	isDocument,
} from "@stratakit/internal-utils/dom";

/**
 * A Map of WeakMaps containing information for all stylesheets.
 *
 * The outer Map expects string keys (unique per set of CSS contents).
 * The inner WeakMap maintains a single CSSStyleSheet object per window (to enable reuse).
 */
const styleSheets = new Map<string, WeakMap<Window, CSSStyleSheet>>(
	Object.entries({ default: new WeakMap() }),
);

/**
 * Maintains counts for stylesheet references (differentiated by key) per root node.
 * Ensures stylesheets are only removed when the _last_ consumer cleans up.
 */
const styleSheetRefs = new Map<string, WeakMap<Document | ShadowRoot, number>>(
	Object.entries({ default: new WeakMap() }),
);

/**
 * Adds css to the root node using `adoptedStyleSheets` in modern browsers.
 *
 * Pass an optional key to distinguish multiple stylesheets from each other.
 *
 * Returns a cleanup function to remove the styles.
 */
export function loadStyles(
	rootNode: Document | ShadowRoot,
	{ css, key = "default" }: { css: string; key?: string },
) {
	let cleanup = () => {};

	const loaded = (() => {
		if (!isBrowser) return false;
		if (!supportsAdoptedStylesheets) return false;

		const ownerDocument = getOwnerDocument(rootNode);
		const _window = getWindow(rootNode);

		if (!ownerDocument || !_window) return false;

		const styleSheet =
			styleSheets.get(key)?.get(_window) || new _window.CSSStyleSheet();
		if (!styleSheets.has(key)) styleSheets.set(key, new WeakMap());
		if (!styleSheets.get(key)?.has(_window)) {
			styleSheets.get(key)?.set(_window, styleSheet);
			styleSheet.replaceSync(css);
		}

		// Track reference count for this stylesheet in this root node
		const refs = styleSheetRefs.get(key) || new WeakMap();
		if (!styleSheetRefs.has(key)) styleSheetRefs.set(key, refs);

		const currentCount = refs.get(rootNode) || 0;
		refs.set(rootNode, currentCount + 1);

		if (!rootNode.adoptedStyleSheets.includes(styleSheet)) {
			rootNode.adoptedStyleSheets.push(styleSheet);
		}

		// Only remove the stylesheet when the last reference is cleaned up,
		// otherwise simply decrement the reference count.
		cleanup = () => {
			const count = refs.get(rootNode) || 0;
			if (count <= 1) {
				refs.delete(rootNode);
				rootNode.adoptedStyleSheets = rootNode.adoptedStyleSheets.filter(
					(sheet) => sheet !== styleSheet,
				);
			} else {
				refs.set(rootNode, count - 1);
			}
		};

		return true;
	})();

	return { loaded, cleanup };
}

// ----------------------------------------------------------------------------

/**
 * Maintains a single `@layer reset` style element per root node, along with
 * the number of consumers using it.
 */
const resetLayers = new WeakMap<
	Document | ShadowRoot,
	{ styleElement: HTMLStyleElement; count: number }
>();

/**
 * Adds `@layer reset` in a style element at the top of the root node, before all other styles.
 *
 * Returns a cleanup function, which removes the style element once the _last_ consumer cleans up.
 */
export function loadResetLayer(rootNode: Document | ShadowRoot) {
	const ownerDocument = getOwnerDocument(rootNode);
	if (!ownerDocument) return () => {};

	let entry = resetLayers.get(rootNode);
	if (!entry) {
		const styleElement = ownerDocument.createElement("style");
		styleElement.textContent = "@layer reset;";
		entry = { styleElement, count: 0 };
		resetLayers.set(rootNode, entry);
	}

	entry.count++;

	// Re-prepend in case other styles were inserted before it since the first consumer.
	(isDocument(rootNode) ? rootNode.head : rootNode).prepend(entry.styleElement);

	return () => {
		entry.count--;
		if (entry.count === 0) {
			entry.styleElement.remove();
			resetLayers.delete(rootNode);
		}
	};
}

// ----------------------------------------------------------------------------

const supportsAdoptedStylesheets =
	isBrowser && "adoptedStyleSheets" in Document.prototype;
