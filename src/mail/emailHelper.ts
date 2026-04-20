import { Resend } from 'resend';
import config from '../config';
import { ISendEmail } from './email';
import { errorLogger, logger } from 'logger/logger';

const resend = new Resend(config.resend.api_key);

const sendEmail = async (values: ISendEmail) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `${config.app_public_name} <${config.resend.mail_domain}>` as string,
      to: values.to as string,
      subject: values.subject,
      html: values.html,
    });

    if (error) {
      errorLogger.error('Email Error', error);
      return;
    }

    logger.info('Mail sent successfully', data);
  } catch (error) {
    errorLogger.error('Email', error);
  }
};

export const emailHelper = {
  sendEmail,
};
