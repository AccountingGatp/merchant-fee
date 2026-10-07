Merchant Fee Automation — corrected single-method build

Processing method
- Net Payments by Order is the source of truth for Date, gateway and Shopify OrderID.
- Blank Shopify Order names are retained using TXN-{Transaction ID} rather than dropped.
- Duplicate Net Payment rows for the same Date + Gateway + OrderID are combined into one order-level record.
- Shopify daily fee pool comes from every fee-bearing Payment Transactions row, excluding payout/balance-transfer summaries only.
- Afterpay daily fee pool comes from the Settlement report.
- PayPal includes sales/refunds only, preserves refund fee reversal signs, converts non-AUD amounts by historical transaction-date FX, and allocates the daily fee pool pro-rata to Shopify PayPal orders.
- Monetary output is rounded to 2 decimals with cent-exact daily residual handling.
- Merchant Fee workbook contains Main, Afterpay, Paypal and Shopify sheets.
- Payment Gateway Summary CSV is generated from Net Payments by Order.
- Xero Manual Journal CSV uses the supplied template headers and the account/tax mappings from the supplied Xero example/SOP.

Privacy
- Real sample transaction files are intentionally NOT included in this production folder.

Xero sign convention currently implemented
- Debit amount: plain positive number (for example 141.73; no '+' character)
- Credit amount: negative number (for example -155.91)
This must be confirmed against one successful Xero import before production if the organisation expects a different convention.
