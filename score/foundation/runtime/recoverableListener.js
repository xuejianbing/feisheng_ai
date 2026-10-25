// on/off need not be atomic: an exception may occur after their side effect.
// A retired lease always stays inert, even if the host cannot remove it.
export function createRecoverableListener(host, event) {
    let lease=null;
    return {
        install(handler) {
            if(lease){lease.handler=handler;lease.enabled=true;return;}
            const next={enabled:true,handler};
            next.dispatch=(...args)=>{if(next.enabled)return next.handler(...args);};
            try { host.on(event,next.dispatch);lease=next; }
            catch(error){next.enabled=false;try{host.off?.(event,next.dispatch);}catch{}throw error;}
        },
        uninstall() {
            if(!lease)return;
            lease.enabled=false;
            if(typeof host.off!=='function')return; // one reusable dispatcher
            const previous=lease;lease=null;
            host.off(event,previous.dispatch);
        },
    };
}
