import { CipherGCMTypes } from "crypto"
import * as crypto from 'crypto'
import { readFileSync, writeFileSync } from "fs"
import Multiplayer from "./main"

export class PasswordManager {
    private _key: Buffer
    private _salt: Buffer
    private _plugin: Multiplayer

    /**
     * A simple utility to securely manage passwords
     *
     * @param {string} password
     * 
     * The constructor will throw an error if the wrong password is provided
     */
    constructor(password: string, plugin: Multiplayer) {
        const salt = plugin.settings.salt 
        this._plugin = plugin
        if (salt) {
            this._salt = Buffer.from(salt, "base64")
            this._key = getKeyFromPassword(Buffer.from(password), this._salt)
            // To immediately detect whether we have the right password, try to decrypt one
            plugin.settings.sharedFolders.some(folder => {
                if (folder.encPw) {
                    decrypt(Buffer.from(folder.encPw, "base64"), this._key)
                    return true
                }
            })
        } else {
            this._salt = getSalt()
            this._key = getKeyFromPassword(Buffer.from(password), this._salt)
            plugin.settings.salt = this._salt.toString("base64")
        }

    }

    /**
     * 
     * @param {string} newPassword The new password to be used
     * @param {string[]} guids The list of all guids to have their passwords updated
     */
    resetPassword(newPassword: string, guids: string[]) {
        this._salt = getSalt()
        const newKey = getKeyFromPassword(Buffer.from(newPassword), this._salt)
        guids.forEach(guid => {
            let pw = Buffer.from(this.getPassword(guid))

            this._plugin.settings.sharedFolders.some( folder => {
                if (folder.guid == guid) { 
                    folder.encPw = encrypt(pw, newKey).toString("base64")
                    return true
                }
            })
        })
        this._key = newKey
    }

    getPassword(guid: string): string {
        const folder = this._plugin.settings.sharedFolders.find( el => el.guid == guid)
        if (folder) {
            if (folder.encPw) {
                return decrypt(Buffer.from(folder.encPw, "base64"), this._key).toString()
            } else return ""
        }
        else return null
    }

    encryptPassword(password: string): string {
        if (password) {
            return encrypt(Buffer.from(password), this._key).toString("base64")
        } else return ""
    }
}

const ALGORITHM = {

    /**
     * GCM is an authenticated encryption mode that
     * not only provides confidentiality but also 
     * provides integrity in a secured way
     * */
    BLOCK_CIPHER: 'aes-256-gcm' as CipherGCMTypes,

    /**
     * 128 bit auth tag is recommended for GCM
     */
    AUTH_TAG_BYTE_LEN: 16,

    /**
     * NIST recommends 96 bits or 12 bytes IV for GCM
     * to promote interoperability, efficiency, and
     * simplicity of design
     */
    IV_BYTE_LEN: 12,

    /**
     * Note: 256 (in algorithm name) is key size. 
     * Block size for AES is always 128
     */
    KEY_BYTE_LEN: 32,

    /**
     * To prevent rainbow table attacks
     * */
    SALT_BYTE_LEN: 16
}

const getIV = () => crypto.randomBytes(ALGORITHM.IV_BYTE_LEN);
function getRandomKey() { crypto.randomBytes(ALGORITHM.KEY_BYTE_LEN); }

/**
 * To prevent rainbow table attacks
 * */
function getSalt() { return crypto.randomBytes(ALGORITHM.SALT_BYTE_LEN); }

/**
 * 
 * @param {Buffer} password - The password to be used for generating key
 * 
 * To be used when key needs to be generated based on password.
 * The caller of this function has the responsibility to clear 
 * the Buffer after the key generation to prevent the password 
 * from lingering in the memory
 */
function getKeyFromPassword(password: Buffer, salt: Buffer) {
    return crypto.scryptSync(password, salt, ALGORITHM.KEY_BYTE_LEN);
}

/**
 * 
 * @param {Buffer} messagetext - The clear text message to be encrypted
 * @param {Buffer} key - The key to be used for encryption
 * 
 * The caller of this function has the responsibility to clear 
 * the Buffer after the encryption to prevent the message text 
 * and the key from lingering in the memory
 */
function encrypt(messagetext: Buffer, key: Buffer) {
    const iv = getIV();
    const cipher = crypto.createCipheriv(
        ALGORITHM.BLOCK_CIPHER, key, iv,
        { 'authTagLength': ALGORITHM.AUTH_TAG_BYTE_LEN })
    let encryptedMessage = cipher.update(messagetext);
    encryptedMessage = Buffer.concat([encryptedMessage, cipher.final()]);
    return Buffer.concat([iv, encryptedMessage, cipher.getAuthTag()]);
}

/**
 * 
 * @param {Buffer} ciphertext - Cipher text
 * @param {Buffer} key - The key to be used for decryption
 * 
 * The caller of this function has the responsibility to clear 
 * the Buffer after the decryption to prevent the message text 
 * and the key from lingering in the memory
 */
function decrypt(ciphertext: Buffer, key: Buffer) {
    const authTag = ciphertext.slice(-ALGORITHM.AUTH_TAG_BYTE_LEN);
    const iv = ciphertext.slice(0, ALGORITHM.IV_BYTE_LEN);
    const encryptedMessage = ciphertext.slice(ALGORITHM.IV_BYTE_LEN, -ALGORITHM.AUTH_TAG_BYTE_LEN);
    const decipher = crypto.createDecipheriv(
        ALGORITHM.BLOCK_CIPHER, key, iv,
        { 'authTagLength': ALGORITHM.AUTH_TAG_BYTE_LEN })
    decipher.setAuthTag(authTag);
    let messagetext = decipher.update(encryptedMessage);
    messagetext = Buffer.concat([messagetext, decipher.final()]);
    return messagetext;
}