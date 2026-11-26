/* PropTypes stand-in for the Recharts browser build (checks are off in production) */
(function(){const v=function(){return null};v.isRequired=v;const P=new Proxy(function(){return P},{get:(t,k)=>k==="default"?P:k==="__esModule"?false:k==="checkPropTypes"?()=>{}:(k==="isRequired"?v:new Proxy(function(){return v},{get:(a,b)=>b==="isRequired"?v:undefined}))});window.PropTypes=P;})();
