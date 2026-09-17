/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu

/** All items that can be shown in the menu. */
sealed interface FenixMenuItem {
    /** A menu item allowing to customize the reader view. */
    data object CustomizeReaderView : FenixMenuItem

    /** A menu item allowing to view the current VPN status or change its configuration. */
    data object IPProtection : FenixMenuItem

    /** A menu item allowing to bookmark the current page, or to edit the bookmark it already has. */
    data object Bookmark : FenixMenuItem

    /** A menu item allowing to start the find in page feature. */
    data object FindInPage : FenixMenuItem

    /** A menu item allowing to switch the current page between the desktop and the mobile version. */
    data object DesktopSite : FenixMenuItem

    /** A menu item allowing to navigate back. */
    data object Back : FenixMenuItem
}

/**
 * Configuration of a menu section.
 *
 * @property id A unique identifier for this section.
 * @property presentationMode How the items in this section should be shown.
 * @property items The items to show in this section.
 * @property isSticky Whether this section should be sticky at the top or bottom of the menu.
 */
data class MenuSectionConfiguration(
    val id: String,
    val presentationMode: MenuPresentationMode,
    val items: List<FenixMenuItem>,
    val isSticky: Boolean = false,
)

/** How the [FenixMenuItem] should be shown inside a menu section. */
sealed class MenuPresentationMode {

    /** Show the items in a row. */
    data object Row : MenuPresentationMode()

    /** Show the items in a grid. */
    data object Grid : MenuPresentationMode()
}
