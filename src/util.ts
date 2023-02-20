import { createWriteStream, read, readFile, readFileSync, writeFileSync } from "fs"
import JSZip from 'jszip'
import { CipherGCMTypes } from "crypto"
import * as crypto from 'crypto'

export function backup(path: string) {
    let file = path + "/" + Date.now().toString() + "-multiplayer-backup.zip"
    let zip: JSZip = new JSZip()
    window.indexedDB.databases().then(databases => { //load all databases
        var counter = 0
        databases.forEach(dbInfo => {
            let req = window.indexedDB.open(dbInfo.name, dbInfo.version) // for each one...
            req.onerror = event => {
                counter++
                console.error(event)
            }

            req.onsuccess = event => {
                try {
                    let folder = zip.folder(dbInfo.name) // create a folder in the archive using the guid 
                    var db = (event.target as IDBOpenDBRequest).result

                    var txn = db.transaction(["updates"], "readonly");
                    txn.onerror = event => {
                        counter++
                        console.error(event)
                        return
                    }

                    var store = txn.objectStore("updates");
                    var loadrequest = store.getAll(); // get all the update data from IndexedDB
                    loadrequest.onerror = event => {
                        counter++
                        console.debug(event) //Probably not a yjs objectstore
                        return
                    }

                    loadrequest.onsuccess = () => {
                        counter++
                        var data = loadrequest.result;
                        let bak = JSON.stringify(data)
                        folder.file("updates", bak) // stringify it and put it in the "updates" file
                        if (counter >= databases.length) {
                            zip.generateNodeStream({ type: "nodebuffer", streamFiles: true }).pipe(createWriteStream(file)).on('finish', () => {
                                console.debug("backed up", file)
                            }).on("error", (e) => {
                                console.error(e)
                            })
                        }
                    }
                } catch (err) {
                    counter++
                    console.debug(err)
                }
            }

        })
    })
}

export function loadBackup(filePath: string) {
    readFile(filePath, (err, data) => {
        if (err) {
            console.error(err)
            return
        }

        JSZip.loadAsync(data).then(zip => {
            zip.forEach((path, file) => {
                if (path.includes("updates")) {
                    file.async('text').then(value => {
                        let bak = JSON.parse(value)
                        let components = path.split("/")
                        let guid = path[-2]

                        let req = window.indexedDB.open(guid)

                        req.onerror = event => console.error(event)
                        req.onsuccess = event => {
                            var db = (event.target as IDBOpenDBRequest).result
                            var txn = db.transaction(["updates"], "readwrite");
                            var store = txn.objectStore("updates");
                            var loadrequest = store.put(bak);
                            loadrequest.onerror = event => console.debug(event)
                        }
                    })
                }
            })
        })
    })
}

export function exportPasswords(guids: string[], path: string, key: string) {
    let obj = new Map<string, string>
    guids.forEach(guid => {
        obj.set(guid, getPassword(guid))
    })

    const data = JSON.stringify(obj)
    const enc = encrypt(Buffer.from(data), Buffer.from(key))
    writeFileSync(path, enc)
}

export function loadPasswordFile(path: string, key: string) {
    const data = JSON.parse(decrypt(readFileSync(path), Buffer.from(key)).toString()) as Map<string, string>
    data.forEach((guid, pw) => {
        setPassword(guid, pw)
    })
}

export function getPassword(guid: string) {
   return safeStorage.decryptString(Buffer.from(localStorage.getItem(guid), "base64"))
}

export function setPassword(guid: string, password: string) {
    localStorage.setItem(guid, safeStorage.encryptString(password).toString("base64"))
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
function getRandomKey () { crypto.randomBytes(ALGORITHM.KEY_BYTE_LEN); }

/**
 * To prevent rainbow table attacks
 * */
function getSalt () { crypto.randomBytes(ALGORITHM.SALT_BYTE_LEN); }

/**
 * 
 * @param {Buffer} password - The password to be used for generating key
 * 
 * To be used when key needs to be generated based on password.
 * The caller of this function has the responsibility to clear 
 * the Buffer after the key generation to prevent the password 
 * from lingering in the memory
 */
function getKeyFromPassword (password: Buffer, salt: Buffer) {
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
function encrypt (messagetext: Buffer, key: Buffer)  {
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
function decrypt (ciphertext: Buffer, key: Buffer) {
    const authTag = ciphertext.slice(-16);
    const iv = ciphertext.slice(0, 12);
    const encryptedMessage = ciphertext.slice(12, -16);
    const decipher = crypto.createDecipheriv(
        ALGORITHM.BLOCK_CIPHER, key, iv,
        { 'authTagLength': ALGORITHM.AUTH_TAG_BYTE_LEN })
    decipher.setAuthTag(authTag);
    let messagetext = decipher.update(encryptedMessage);
    messagetext = Buffer.concat([messagetext, decipher.final()]);
    return messagetext;
}

