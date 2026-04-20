import jwt, {  SignOptions } from 'jsonwebtoken';


const createJwtToken = (payload: object, secret: string, expireTime: string | number) => {
  return jwt.sign(payload, secret, { expiresIn: expireTime as SignOptions['expiresIn'] });
};
export default createJwtToken;