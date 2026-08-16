/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.selectors

import mozilla.components.browser.toolbar.R as toolbarR
import mozilla.components.compose.browser.toolbar.concept.BrowserToolbarTestTags.ADDRESSBAR_SEARCH_BOX
import mozilla.components.compose.browser.toolbar.concept.BrowserToolbarTestTags.SEARCH_SELECTOR
import org.mozilla.fenix.R
import org.mozilla.fenix.helpers.DataGenerationHelper.getStringResource
import org.mozilla.fenix.ui.efficiency.helpers.Selector
import org.mozilla.fenix.ui.efficiency.helpers.SelectorStrategy

object SearchBarSelectors {
    val TOOLBAR_IN_EDIT_MODE =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = ADDRESSBAR_SEARCH_BOX,
            description = "Toolbar in edit mode",
            groups = listOf(),
        )

    val URL_TEXT =
        Selector(
            strategy = SelectorStrategy.UIAUTOMATOR_WITH_RES_ID,
            value = "mozac_browser_toolbar_url_view",
            description = "Page URL",
            groups = listOf("requiredForBrowserPage"),
        )

    val SEARCH_ENGINE_SELECTOR =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = SEARCH_SELECTOR,
            description = "Search engine selector button",
            groups = listOf("requiredForPage"),
        )

    // An engine row inside the search-selector popup menu. Each row exposes the plain engine name as
    // its content-description (mirrors the legacy verifySearchShortcutList / selectTemporarySearchMethod
    // which matched hasContentDescription(engineName)).
    @Suppress("FunctionName")
    fun SEARCH_SELECTOR_MENU_ENGINE(engineName: String = "") =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_CONTENT_DESCRIPTION,
            value = engineName,
            description = "Search selector menu engine: $engineName",
            groups = listOf(),
        )

    // A single awesomebar suggestion row. The tag is on each suggestion item (the container uses the
    // plural "mozac.awesomebar.suggestions"). Verified against ground truth as a collection with
    // mozVerifyAnyContainsText / mozVerifyNoneContainText.
    val AWESOMEBAR_SUGGESTION =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TAG,
            value = "mozac.awesomebar.suggestion",
            description = "Awesomebar search suggestion",
            groups = listOf(),
        )

    // Text, not content-description, and deliberately so despite text being the last-resort handle: in edit
    // mode the hint is rendered as its own text node, and ADDRESSBAR_SEARCH_BOX carries no description at
    // all (verified from a ScreenDump of the search view). The browser-view address bar does expose the hint
    // as part of its description, but that is a different element in a different state. Keyed off the string
    // resource so it survives localization.
    val SEARCH_BAR_PLACEHOLDER =
        Selector(
            strategy = SelectorStrategy.COMPOSE_BY_TEXT,
            value = getStringResource(R.string.search_hint),
            description = "Search bar placeholder",
            groups = listOf(),
        )

    // Clear (X) button in the edit-mode toolbar. Content-description "Clear", keyed off the string
    // resource so it survives localization (mirrors the legacy SearchRobot.clickClearButton).
    // UiObject2 (By.descContains) rather than UiObject: UiObject.click() returns false on this button
    // even when the tap lands (the framework then throws "Failed to click UiObject"); UiObject2.click()
    // does not gate on that return value. Same gotcha as the applinks prompt buttons.
    val CLEAR_BUTTON =
        Selector(
            strategy = SelectorStrategy.UIAUTOMATOR2_BY_DESCRIPTION_CONTAINS,
            value = getStringResource(toolbarR.string.mozac_clear_button_description),
            description = "Search bar clear button",
            groups = listOf(),
        )

    val all =
        listOf(
            TOOLBAR_IN_EDIT_MODE,
            URL_TEXT,
            SEARCH_ENGINE_SELECTOR,
            SEARCH_SELECTOR_MENU_ENGINE(),
            AWESOMEBAR_SUGGESTION,
            SEARCH_BAR_PLACEHOLDER,
            CLEAR_BUTTON,
        )
}
