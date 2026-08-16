package mozilla.components.feature.downloads.fake

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.feature.downloads.filewriter.DownloadFileWriter

class FakeDownloadFileWriter(private val executeBlock: Boolean = false) : DownloadFileWriter {
    var lastAppend: Boolean? = null

    override fun useFileStream(
        download: DownloadState,
        append: Boolean,
        shouldUseScopedStorage: Boolean,
        onUpdateState: (DownloadState) -> Unit,
        block: (OutputStream) -> Unit,
    ) {
        lastAppend = append
        if (executeBlock) {
            block(ByteArrayOutputStream())
        }
    }
}
