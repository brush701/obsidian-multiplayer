import { createWriteStream, read, readFile } from "fs"
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
                        console.log(counter, "/", databases.length)
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