import { CipherGCMTypes } from "crypto"
import * as crypto from "crypto"
import { createWriteStream, read, readFile, readFileSync, writeFileSync } from "fs"
import JSZip from 'jszip'

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

export const isVersionNewerThanOther = (version: string, otherVersion: string): boolean => {
    const v = version.match(/(\d*)\.(\d*)\.(\d*)/);
    const o = otherVersion.match(/(\d*)\.(\d*)\.(\d*)/);
    
    return Boolean(v && v.length === 4 && o && o.length === 4 &&
      !(isNaN(parseInt(v[1])) || isNaN(parseInt(v[2])) || isNaN(parseInt(v[3]))) &&
      !(isNaN(parseInt(o[1])) || isNaN(parseInt(o[2])) || isNaN(parseInt(o[3]))) && 
      (
        parseInt(v[1])>parseInt(o[1]) ||
        (parseInt(v[1]) >= parseInt(o[1]) && parseInt(v[2]) > parseInt(o[2])) ||
        (parseInt(v[1]) >= parseInt(o[1]) && parseInt(v[2]) >= parseInt(o[2]) && parseInt(v[3]) > parseInt(o[3]))
      )
    ) 
  }