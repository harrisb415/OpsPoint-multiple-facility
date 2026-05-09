// ── File System & Storage ───────────────────────────────────
// ── File System ────────────────────────────────────────────────
const IDB_DB='sp_fs',IDB_STORE='handles',IDB_KEY='dir_handle',DATA_FILE='sp_data.json';
let dirHandle=null;
function openIDB(){return new Promise((res,rej)=>{const r=indexedDB.open(IDB_DB,1);r.onupgradeneeded=e=>e.target.result.createObjectStore(IDB_STORE);r.onsuccess=e=>res(e.target.result);r.onerror=rej;});}
async function saveHandle(h){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(h,IDB_KEY);tx.oncomplete=res;tx.onerror=rej;});}
async function loadHandle(){const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,'readonly');const r=tx.objectStore(IDB_STORE).get(IDB_KEY);r.onsuccess=e=>res(e.target.result);r.onerror=rej;});}
async function doSelectFolder(){
  try{
    // Use last saved handle as startIn so picker opens in the right place
    var opts = {mode:"readwrite"};
    try{var prev=await loadHandle();if(prev)opts.startIn=prev;}catch(e){}
    dirHandle = await window.showDirectoryPicker(opts);
    await saveHandle(dirHandle);
    updateFolderUI();
    await loadData();
    buildRoster();
    renderLog();
    renderIssues();
    renderClientTable();
    renderMedNotes();
    setSaveMsg("Folder connected","saved");
    setTimeout(function(){setSaveMsg("Auto-save on","");},2500);
    document.getElementById("folder-gate-modal").classList.remove("open");
  } catch(e) {
    if(e.name !== "AbortError") alert("Could not access folder: " + e.message);
  }
}
async function selectFolder(){try{dirHandle=await window.showDirectoryPicker({mode:'readwrite'});await saveHandle(dirHandle);updateFolderUI();await loadData();buildRoster();renderLog();renderIssues();renderClientTable();setSaveMsg('Folder connected','saved');setTimeout(()=>setSaveMsg('Auto-save on',''),2500);}catch(e){if(e.name!=='AbortError')alert('Could not access folder: '+e.message);}}
async function tryRestoreHandle(){try{const h=await loadHandle();if(!h)return false;const p=await h.requestPermission({mode:'readwrite'});if(p!=='granted')return false;dirHandle=h;updateFolderUI();return true;}catch(e){return false;}}
function updateFolderUI(){const el=document.getElementById('fb-path');if(dirHandle){el.textContent=dirHandle.name+' / '+DATA_FILE;el.classList.remove('none');}else{el.textContent='No folder selected — click Select Folder to enable saving';el.classList.add('none');}}
async function readData(){if(!dirHandle)return null;try{const fh=await dirHandle.getFileHandle(DATA_FILE);return JSON.parse(await(await fh.getFile()).text());}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
async function writeJsonData(data){
  if(!dirHandle)return;
  try{
    let imgDir=null;
    try{imgDir=await dirHandle.getDirectoryHandle('images',{create:true});}catch(e){}
    async function saveImg(b64,fname){
      if(!imgDir||!b64||!b64.startsWith('data:'))return b64;
      try{
        const bin=atob(b64.split(',')[1]);const arr=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
        const fh=await imgDir.getFileHandle(fname,{create:true});
        const w=await fh.createWritable();await w.write(arr.buffer);await w.close();
        return 'images/'+fname;
      }catch(e){return b64;}
    }
    const clientsOut=await Promise.all((data.clients||[]).map(async c=>{
      const copy={...c};
      if(c.photo&&c.photo.startsWith('data:')){
        const ext=c.photo.includes('image/gif')?'gif':'jpg';
        copy.photo=await saveImg(c.photo,'client_'+c.id+'.'+ext);
      }
      return copy;
    }));
    const logosOut={...(data.logos||LOGOS||{})};
    for(const key of ['pdec','wcs']){
      if(logosOut[key]&&logosOut[key].startsWith('data:')){
        const ext=logosOut[key].includes('image/gif')?'gif':'jpg';
        logosOut[key]=await saveImg(logosOut[key],'logo_'+key+'.'+ext);
      }
    }
    const fh=await dirHandle.getFileHandle(DATA_FILE,{create:true});
    const w=await fh.createWritable();
    await w.write(JSON.stringify({...data,clients:clientsOut,logos:logosOut},null,2));
    await w.close();
  }catch(e){console.error('Save error:',e);}
}
async function writeDocxFile(fname,uint8){if(!dirHandle)return;const fh=await dirHandle.getFileHandle(fname,{create:true});const w=await fh.createWritable();await w.write(uint8);await w.close();}

