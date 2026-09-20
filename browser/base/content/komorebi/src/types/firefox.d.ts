/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

interface DocumentL10n {
    setAttributes(
        element: Element,
        id: string,
        args?: Record<string, unknown>
    ): void;
}

interface Document {
    l10n: DocumentL10n;
}

interface WindowUtils {
    getBoundsWithoutFlushing(element: Element): DOMRect;
}

interface Window {
    windowUtils: WindowUtils;
}

declare const MousePosTracker: { _x?: number; _y?: number } | undefined;