/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.components.menu

import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import mozilla.components.compose.base.text.Text
import mozilla.components.compose.menu.data.MenuItem
import mozilla.components.compose.menu.data.MenuItemsGroup
import mozilla.components.compose.menu.data.StandardMenuItem
import mozilla.components.compose.menu.store.MenuEvent
import org.junit.Test
import org.mozilla.fenix.components.menu.FenixMenuItem.CustomizeReaderView
import org.mozilla.fenix.components.menu.MenuPresentationMode.Grid
import org.mozilla.fenix.components.menu.MenuPresentationMode.Row

class BrowserMenuBuilderTest {
    @Test
    fun `WHEN a provider offers an item THEN show it in the section it is configured in`() = runTest {
        val builder = createBrowserMenuBuilder(Row, providing = readerViewItem)

        assertEquals(
            listOf(MenuItemsGroup.Row(id = MENU_GROUP_ID, items = listOf(readerViewItem))),
            builder.menuStructure.first(),
        )
    }

    @Test
    fun `GIVEN a section is configured as a list WHEN building the menu THEN show its items in a list`() = runTest {
        val builder = createBrowserMenuBuilder(Row, providing = readerViewItem)

        assertEquals(
            listOf(MenuItemsGroup.Row(id = MENU_GROUP_ID, items = listOf(readerViewItem))),
            builder.menuStructure.first(),
        )
    }

    @Test
    fun `GIVEN a section is configured as a grid WHEN building the menu THEN show its items in a grid`() = runTest {
        val builder = createBrowserMenuBuilder(Grid, providing = readerViewItem)

        assertEquals(
            listOf(MenuItemsGroup.Grid(id = MENU_GROUP_ID, items = listOf(readerViewItem))),
            builder.menuStructure.first(),
        )
    }

    @Test
    fun `GIVEN a provider offers no items WHEN building the menu THEN don't show the section it would be in`() =
        runTest {
            val builder = createBrowserMenuBuilder(Row, providing = null)

            assertTrue(builder.menuStructure.first().isEmpty())
        }

    @Test
    fun `WHEN an item changes THEN rebuild the menu with it`() = runTest {
        val provided = MutableStateFlow<MenuItem?>(null)
        val builder =
            BrowserMenuBuilder(
                providers = mapOf(CustomizeReaderView to FakeMenuItemProvider(provided)),
                configuration = sectionOf(Row),
            )

        assertTrue(builder.menuStructure.first().isEmpty())

        provided.value = readerViewItem

        assertEquals(listOf(readerViewItem), builder.menuStructure.first().single().items)
    }

    @Test
    fun `WHEN building the default menu THEN keep the sections in the configured order`() = runTest {
        val providers =
            BrowserMenuBuilder.DEFAULT.flatMap { it.items }
                .associateWith { FakeMenuItemProvider(MutableStateFlow(readerViewItem)) }
        val builder = BrowserMenuBuilder(providers = providers)

        assertEquals(BrowserMenuBuilder.DEFAULT.map { it.id }, builder.menuStructure.first().map { it.id })
    }

    @Test
    fun `GIVEN a section is configured as sticky WHEN building the menu THEN keep it sticky`() = runTest {
        val configuration =
            listOf(
                MenuSectionConfiguration(
                    id = MENU_GROUP_ID,
                    presentationMode = Row,
                    items = listOf(CustomizeReaderView),
                    isSticky = true,
                )
            )
        val builder =
            BrowserMenuBuilder(
                providers = mapOf(CustomizeReaderView to FakeMenuItemProvider(MutableStateFlow(readerViewItem))),
                configuration = configuration,
            )

        assertEquals(true, builder.menuStructure.first().isNotEmpty())
        assertEquals(true, configuration.first().isSticky)
    }

    @Test
    fun `GIVEN toolbar is at bottom WHEN building default layout THEN navigation block appears at the bottom`() =
        runTest {
            val providers =
                BrowserMenuBuilder.DEFAULT.flatMap { it.items }
                    .associateWith { FakeMenuItemProvider(MutableStateFlow(readerViewItem)) }
            val builder = BrowserMenuBuilder(providers = providers, isToolbarAtBottom = true)

            assertEquals(BrowserMenuBuilder.BROWSER_MENU_NAVIGATION_ID, builder.menuStructure.first().last().id)
        }

    @Test
    fun `GIVEN toolbar is at top WHEN building default layout THEN navigation block appears at the top`() = runTest {
        val providers =
            BrowserMenuBuilder.DEFAULT.flatMap { it.items }
                .associateWith { FakeMenuItemProvider(MutableStateFlow(readerViewItem)) }
        val builder = BrowserMenuBuilder(providers = providers, isToolbarAtBottom = false)

        assertEquals(BrowserMenuBuilder.BROWSER_MENU_NAVIGATION_ID, builder.menuStructure.first().first().id)
    }

    @Test
    fun `GIVEN toolbar is expended WHEN building default layout THEN navigation block appears at the bottom`() =
        runTest {
            val providers =
                BrowserMenuBuilder.DEFAULT.flatMap { it.items }
                    .associateWith { FakeMenuItemProvider(MutableStateFlow(readerViewItem)) }
            val builder =
                BrowserMenuBuilder(providers = providers, isToolbarAtBottom = false, isExpandedToolbarEnabled = true)

            assertEquals(BrowserMenuBuilder.BROWSER_MENU_NAVIGATION_ID, builder.menuStructure.first().last().id)
        }

    private fun createBrowserMenuBuilder(
        presentationMode: MenuPresentationMode,
        providing: MenuItem?,
    ) =
        BrowserMenuBuilder(
            providers = mapOf(CustomizeReaderView to FakeMenuItemProvider(MutableStateFlow(providing))),
            configuration = sectionOf(presentationMode),
        )

    private fun sectionOf(presentationMode: MenuPresentationMode) =
        listOf(
            MenuSectionConfiguration(
                id = MENU_GROUP_ID,
                presentationMode = presentationMode,
                items = listOf(CustomizeReaderView),
            )
        )

    private class FakeMenuItemProvider(override val itemFlow: StateFlow<MenuItem?>) : MenuItemProvider

    private data object TestMenuEvent : MenuEvent

    private companion object {
        const val MENU_GROUP_ID = "section"

        val readerViewItem = StandardMenuItem(title = Text.String("Item"), onClickEvent = TestMenuEvent)
    }
}
