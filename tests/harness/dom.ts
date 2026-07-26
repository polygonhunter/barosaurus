/**
 * Obsidian's DOM extensions, installed onto jsdom.
 *
 * Obsidian augments Node/HTMLElement at runtime with createDiv, empty,
 * hasClass, setCssStyles, `win`, `doc` and friends. `src/ui/**` uses them on
 * every line, so without this the UI tests fail on the first render for a
 * reason that has nothing to do with the code under test.
 *
 * Loaded as a vitest setup file, and a no-op outside a DOM environment so the
 * core tests keep running under plain node.
 */

interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	href?: string;
	type?: string;
	value?: string;
	placeholder?: string;
	parent?: Node;
	prepend?: boolean;
}

function applyInfo(el: HTMLElement, info?: DomElementInfo | string): void {
	if (info === undefined) return;
	if (typeof info === "string") {
		el.className = info;
		return;
	}
	if (info.cls !== undefined) {
		el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	}
	if (info.text !== undefined) el.textContent = info.text;
	if (info.title !== undefined) el.setAttribute("title", info.title);
	if (info.href !== undefined) el.setAttribute("href", info.href);
	if (info.type !== undefined) el.setAttribute("type", info.type);
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
	if (info.placeholder !== undefined) el.setAttribute("placeholder", info.placeholder);
	if (info.attr !== undefined) {
		for (const [key, value] of Object.entries(info.attr)) {
			if (value === null) continue;
			el.setAttribute(key, String(value));
		}
	}
}

export function installObsidianDom(): void {
	if (typeof document === "undefined") return;

	const node = Node.prototype as unknown as Record<string, unknown>;
	const element = HTMLElement.prototype as unknown as Record<string, unknown>;

	function createEl(this: Node, tag: string, info?: DomElementInfo | string): HTMLElement {
		const el = document.createElement(tag);
		applyInfo(el, info);
		// Obsidian APPENDS — the behaviour that makes createDiv wrong wherever a
		// detached element is wanted. Faithful on purpose.
		const parent = typeof info === "object" && info?.parent !== undefined ? info.parent : this;
		if (typeof info === "object" && info?.prepend === true) {
			parent.insertBefore(el, parent.firstChild);
		} else {
			parent.appendChild(el);
		}
		return el;
	}

	node["createEl"] = function (
		this: Node,
		tag: string,
		info?: DomElementInfo | string,
		cb?: (el: HTMLElement) => void,
	) {
		const el = createEl.call(this, tag, info);
		cb?.(el);
		return el;
	};
	node["createDiv"] = function (
		this: Node,
		info?: DomElementInfo | string,
		cb?: (el: HTMLElement) => void,
	) {
		const el = createEl.call(this, "div", info);
		cb?.(el);
		return el;
	};
	node["createSpan"] = function (
		this: Node,
		info?: DomElementInfo | string,
		cb?: (el: HTMLElement) => void,
	) {
		const el = createEl.call(this, "span", info);
		cb?.(el);
		return el;
	};
	node["createSvg"] = function (this: Node, tag: string) {
		const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
		this.appendChild(el);
		return el;
	};

	node["empty"] = function (this: Node) {
		while (this.firstChild !== null) this.removeChild(this.firstChild);
	};
	node["detach"] = function (this: ChildNode) {
		this.remove();
	};
	node["setText"] = function (this: Node, text: string) {
		this.textContent = text;
	};

	Object.defineProperty(node, "win", {
		configurable: true,
		get(this: Node) {
			return (this.ownerDocument ?? document).defaultView;
		},
	});
	Object.defineProperty(node, "doc", {
		configurable: true,
		get(this: Node) {
			return this.ownerDocument ?? document;
		},
	});

	element["addClass"] = function (this: HTMLElement, ...cls: string[]) {
		this.classList.add(...cls.filter((c) => c.length > 0));
	};
	element["removeClass"] = function (this: HTMLElement, ...cls: string[]) {
		this.classList.remove(...cls.filter((c) => c.length > 0));
	};
	element["addClasses"] = function (this: HTMLElement, cls: readonly string[]) {
		this.classList.add(...cls.filter((c) => c.length > 0));
	};
	element["removeClasses"] = function (this: HTMLElement, cls: readonly string[]) {
		this.classList.remove(...cls.filter((c) => c.length > 0));
	};
	element["toggleClass"] = function (this: HTMLElement, cls: string | string[], on: boolean) {
		for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, on);
	};
	element["hasClass"] = function (this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	};
	element["setAttrs"] = function (this: HTMLElement, attrs: Record<string, string>) {
		for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
	};
	element["setCssStyles"] = function (this: HTMLElement, styles: Record<string, string>) {
		for (const [k, v] of Object.entries(styles)) {
			this.style.setProperty(k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), v);
		}
	};
	element["setCssProps"] = function (this: HTMLElement, props: Record<string, string>) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};

	// `scrollIntoView` exists in jsdom's API surface but throws "not
	// implemented"; the bar calls it on every selection change.
	element["scrollIntoView"] = function () {
		/* layout is not modelled */
	};

	const win = globalThis as unknown as Record<string, unknown>;
	win["createEl"] = (tag: string, info?: DomElementInfo | string) =>
		createEl.call(document.body, tag, info);
	win["createDiv"] = (info?: DomElementInfo | string) =>
		createEl.call(document.body, "div", info);
	win["createSpan"] = (info?: DomElementInfo | string) =>
		createEl.call(document.body, "span", info);
	win["createFragment"] = () => document.createDocumentFragment();
	win["activeWindow"] = globalThis.window;
	win["activeDocument"] = globalThis.document;
}

installObsidianDom();
