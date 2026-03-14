import { Resend } from "resend";

import { StatusCodes } from "http-status-codes";
import config from "../config";
import AppError from "../errors/AppError";

const resend = new Resend(config.resend.api_key);

export async function sendEmail(email: string, subject: string, text: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: `TrueDots <${config.resend.mail_domain}>` as string,
      to: email,
      subject: subject,
      html: `
      <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Promotional Email</title>
  <style>
    /* Reset styles */
    body, html {
      margin: 0;
      padding: 0;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background-color: #f8f8f8;
      color: #333;
    }

    /* Container styles */
    .container {
      max-width: 600px;
      margin: 30px auto;
      padding: 20px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(145deg, #ffffff, #e6e6e6);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
    }

    /* Header styles */
    .header {
      background-color: #5C450D; /* Gold-inspired header */
      padding: 30px;
      border-radius: 12px 12px 0 0;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      font-size: 24px;
      margin: 0;
      font-weight: 700;
      letter-spacing: 1px;
    }

    /* Content styles */
    .content {
      padding: 20px 30px;
      text-align: left;
      font-size: 16px;
      line-height: 1.8;
      color: #4a4a4a;
    }

    /* Footer styles */
    .footer {
      background-color: #785B12; /* Darker gold footer */
      padding: 20px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      color: #ffffff;
      font-size: 12px;
    }
    .footer p {
      margin: 0;
    }

    /* Responsive styles */
    @media (max-width: 600px) {
      .container {
        padding: 15px;
      }
      .content {
        padding: 15px;
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${subject}</h1>
    </div>
    <div class="content">
      <p>${text}</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} dot_connection_app. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
     `,
    });

    if (error) {
      throw new AppError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Error sending email",
      );
    }

    return data;
  } catch (error) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Error sending email",
    );
  }
}
