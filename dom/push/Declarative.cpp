/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "Declarative.h"

#include "mozilla/dom/dom_push_rust_generated.h"
#include "mozilla/dom/notification/NotificationUtils.h"
#include "nsNetUtil.h"

namespace mozilla::dom {

using notification::NotificationCallbacksCommon;

class DWPNotificationCallbacks final : public NotificationCallbacksCommon {
 public:
  NS_INLINE_DECL_REFCOUNTING_INHERITED(DWPNotificationCallbacks,
                                       NotificationCallbacksCommon)

  DWPNotificationCallbacks(const nsAString& aScope, nsIPrincipal* aPrincipal,
                           IPCNotification aNotification)
      : NotificationCallbacksCommon(aScope, aPrincipal, aNotification) {}

  NS_IMETHODIMP OnAlertShow() override {
    MOZ_TRY(NotificationCallbacksCommon::OnAlertShow());
    PersistNotification();
    return NS_OK;
  }

  NS_IMETHODIMP OnAlertClick(nsIAlertAction* aAction) override {
    MOZ_TRY(NotificationCallbacksCommon::OnAlertClick(aAction));
    return RespondOnClick(aAction);
  }

  NS_IMETHODIMP OnAlertClosed() override {
    MOZ_TRY(NotificationCallbacksCommon::OnAlertClosed());
    UnpersistNotification();
    return NS_OK;
  }

  NS_IMETHODIMP OnAlertFinished() override {
    MOZ_TRY(NotificationCallbacksCommon::OnAlertFinished());
    UnpersistNotification();
    return NS_OK;
  }

 private:
  virtual ~DWPNotificationCallbacks() = default;
};

bool ParseDeclarativePushAndShowNotification(Span<const uint8_t> aData,
                                             nsIPrincipal* aPrincipal,
                                             const nsACString& aScope) {
  DeclarativePushData declarativePush;
  if (!parse_declarative_push(aData.Elements(), aData.Length(),
                              &declarativePush)) {
    return false;
  }
  RefPtr<nsIURI> baseURI;
  if (NS_FAILED(NS_NewURI(getter_AddRefs(baseURI), aScope))) {
    return false;
  }
  RefPtr<nsIURI> uri;
  nsresult rv = NS_NewURI(getter_AddRefs(uri), declarativePush.navigate,
                          nullptr, baseURI);
  // https://w3c.github.io/push-api/#dfn-declarative-push-message-parser
  // Step 27: If notification's navigation URL is null, then return failure.
  if (NS_FAILED(rv)) {
    return false;
  }
  RefPtr permissionPromise = notification::EnsureValidNotificationPermission(
      aPrincipal, aPrincipal, aPrincipal->GetIsOriginPotentiallyTrustworthy());
  permissionPromise->Then(
      GetCurrentSerialEventTarget(), __func__,
      [data = std::move(declarativePush), scope = NS_ConvertUTF8toUTF16(aScope),
       principal = RefPtr(aPrincipal), navigateURI = RefPtr(uri)](
          const notification::NotificationPermissionPromise::
              ResolveOrRejectValue& aResult) {
        if (aResult.IsReject()) {
          // Don't have permission
          return;
        }
        IPCNotificationOptions options;
        options.title() = std::move(data.title);
        options.navigate() = navigateURI;
        auto result = notification::CreateAlertForNotification(
            options, *principal, Nothing());
        if (result.isErr()) {
          return;
        }
        nsCOMPtr<nsIAlertNotification> notification = result.unwrap();
        nsAutoString id;
        notification->GetId(id);
        RefPtr<DWPNotificationCallbacks> dwpCallbacks =
            new DWPNotificationCallbacks(scope, principal,
                                         IPCNotification(id, options));
        notification::ShowAlertWithCleanup(notification, dwpCallbacks);
      });
  return true;
}

}  // namespace mozilla::dom
