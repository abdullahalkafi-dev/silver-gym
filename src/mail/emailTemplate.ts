import { TResetPassword, TCreateAccount } from "./emailTemplate.type";
const themes = {
  "theme-red": {
    primary: "#e74c3c",
    secondary: "#c0392b",
    accent: "#fdeeee",
  },
  "theme-green": {
    primary: "#2ecc71",
    secondary: "#27ae60",
    accent: "#eafaf1",
  },
  "theme-purple": {
    primary: "#9b59b6",
    secondary: "#8e44ad",
    accent: "#f5eef8",
  },
  "theme-orange": {
    primary: "#f39c12",
    secondary: "#d35400",
    accent: "#fef5e7",
  },
  "theme-blue": {
    primary: "#4a90e2",
    secondary: "#e4edf7",
    accent: "#e7f4fd",
  },
};
const createAccount = (values: TCreateAccount) => {
  const theme = themes[values.theme] ?? themes["theme-blue"];

  const data = {
    to: values.email,
    subject: "Verify your account",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Verification</title>
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      line-height: 1.6;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
      }
      .content-block {
        padding: 20px 15px !important;
      }
      .button {
        width: 100% !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f6f6;">
  <div>
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width: 100%; background-color: #f6f6f6;">
      <tr>
        <td align="center" valign="top">
          <table class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; margin: 20px auto;">
            <!-- Header -->
            <tr>
              <td style="background-color: ${theme.primary}; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">TrueDots</h1>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td class="content-block" style="background-color: #ffffff; padding: 40px 30px; border-left: 1px solid #e6e6e6; border-right: 1px solid #e6e6e6;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <h2 style="color: ${theme.primary}; margin-top: 0;">Hello, ${values.name}!</h2>
                      <p style="color: #333333; margin-bottom: 20px;">Thank you for signing up. Please verify your email address to complete your registration.</p>

                      <!-- Verification button -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <p class="button" style="background-color: ${theme.primary}; border: solid 1px ${theme.secondary}; border-radius: 4px; color: #ffffff; cursor: pointer; display: inline-block; font-size: 16px; font-weight: bold; margin: 0; padding: 12px 25px; text-decoration: none; text-transform: capitalize;">
                              ${values.otp}
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #333333; margin-top: 30px;">If you didn't create an account, you can safely ignore this email.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: ${theme.accent}; padding: 20px; text-align: center; border-left: 1px solid #e6e6e6; border-right: 1px solid #e6e6e6; border-bottom: 1px solid #e6e6e6;">
                <p style="color: #333333; margin: 0; font-size: 14px;">© 2025 TrueDots. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`,
  };

  return data;
};

const resetPassword = (values: TResetPassword) => {
  const theme = themes[values.theme] ?? themes["theme-blue"];

  const data = {
    to: values.email,
    subject: "Reset your password",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Password Reset</title>
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      line-height: 1.6;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
      }
      .content-block {
        padding: 20px 15px !important;
      }
      .button {
        width: 100% !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f6f6;">
  <div>
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width: 100%; background-color: #f6f6f6;">
      <tr>
        <td align="center" valign="top">
          <table class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; margin: 20px auto;">
            <!-- Header -->
            <tr>
              <td style="background-color: ${theme.primary}; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">TrueDots</h1>
              </td>
            </tr>

            <!-- Main content -->
            <tr>
              <td class="content-block" style="background-color: #ffffff; padding: 40px 30px; border-left: 1px solid #e6e6e6; border-right: 1px solid #e6e6e6;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <h2 style="color: ${theme.primary}; margin-top: 0;">Hello, ${values.name}!</h2>
                      <p style="color: #333333; margin-bottom: 20px;">We received a request to reset your password. If you didn't make this request, you can safely ignore this email.</p>
                      <p style="color: #333333; margin-bottom: 30px;">To reset your password, use the OTP below:</p>

                      <!-- OTP button -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <p class="button" style="background-color: ${theme.primary}; border: solid 1px ${theme.secondary}; border-radius: 4px; color: #ffffff; cursor: pointer; display: inline-block; font-size: 16px; font-weight: bold; margin: 0; padding: 12px 25px; text-decoration: none; text-transform: capitalize;">
                              ${values.otp}
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #333333; margin-top: 30px;">This OTP will expire in <strong>${values.expiresIn} minutes</strong>.</p>

                      <!-- Security notice -->
                      <div style="margin-top: 30px; padding: 15px; background-color: ${theme.accent}; border-left: 4px solid ${theme.primary};">
                        <p style="color: #333333; margin: 0; font-size: 14px;"><strong>Security Notice:</strong> Never share this OTP with anyone. Our team will never ask for your password or this reset code.</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: ${theme.accent}; padding: 20px; text-align: center; border-left: 1px solid #e6e6e6; border-right: 1px solid #e6e6e6; border-bottom: 1px solid #e6e6e6;">
                <p style="color: #333333; margin: 0; font-size: 14px;">© 2025 TrueDots. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`,
  };

  return data;
};

export const emailTemplate = {
  createAccount,
  resetPassword,
};
