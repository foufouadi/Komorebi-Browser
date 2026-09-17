/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use nsstring::nsString;
use serde::{Deserialize, Serialize};

#[repr(C)]
pub struct DeclarativePushData {
    title: nsString,
    navigate: nsString,
}

/// notification member of https://w3c.github.io/push-api/#members
#[derive(Serialize, Deserialize)]
struct DeclarativePushNotification {
    title: String,
    navigate: String,
}

/// Declarative push message data. https://w3c.github.io/push-api/#members
#[derive(Serialize, Deserialize)]
struct DeclarativePushJSON {
    web_push: u16,
    notification: DeclarativePushNotification,
}

// https://w3c.github.io/push-api/#dfn-declarative-push-message-parser
fn parse_declarative_push_option(data: &[u8]) -> Option<DeclarativePushData> {
    // Step 1: Let message be the result of parsing JSON bytes to an Infra value given bytes.
    //         If that throws an exception, then return failure.
    // (Leads to https://encoding.spec.whatwg.org/#utf-8-decode which does lossy decoding)
    let string = String::from_utf8_lossy(data);
    let data: DeclarativePushJSON = serde_json::from_str(string.as_ref()).ok()?;
    if data.web_push != 8030 {
        return None;
    }
    let notification = data.notification;
    Some(DeclarativePushData {
        title: nsString::from(&notification.title),
        navigate: nsString::from(&notification.navigate),
    })
}

/// Parse declarative push message.
/// https://w3c.github.io/push-api/#dfn-declarative-push-message-parser
#[unsafe(no_mangle)]
pub unsafe extern "C" fn parse_declarative_push(
    data: *const u8,
    length: usize,
    output: &mut DeclarativePushData,
) -> bool {
    match parse_declarative_push_option(unsafe { std::slice::from_raw_parts(data, length) }) {
        Some(push) => {
            *output = push;
            true
        }
        None => false,
    }
}
