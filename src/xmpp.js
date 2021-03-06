var xmpp   = require('node-xmpp-server');
var events = require('events');
var ltx    = require('ltx');
var api    = require('./api.js');
var Disco  = require('./disco.js');

function xmppServer() {
  events.EventEmitter.call(this);
}

xmppServer.prototype = new events.EventEmitter();

xmppServer.prototype.setup = function(s2sPort, bindAddress, domain, opts) {
  this.router = new xmpp.Router(s2sPort, bindAddress);
  this.router.addSecureDomain(domain);
  var server = this;
  this.router.loadCredentialsFromFile(domain,opts.tls.keyPath,opts.tls.certPath);
  this.router.register(domain,function (stanza) {
    server.handleStanza(stanza);
  });
};

var formDataValue = function(stanza, varName) {
  if (!varName || !stanza ) {
    return;
  }

  resultStanza = stanza.getChildrenByFilter(function (child){
    if (child.attrs) {
      return child.name === 'field' && child.attrs['var'] === varName;
    }
    return false;
  })[0];

  if (resultStanza) {
    return resultStanza.getChildText('value');
  }

  return null;
};

var parsePushStanza = function (stanza,cb) {
  if(stanza.name !== 'iq') {
    cb(new Error('error not iq'),null);
    return;
  }

  var result = {};

  var publishStanza = stanza.getChildrenByFilter( function(child){
    return child.name === 'publish';
  },true)[0];

  if ( typeof publishStanza === "undefined" || publishStanza === null ) {
    var error = new Error('Invalid stanza xml. Missing publish.');
    cb(error);
    return;
  }

  var formData = publishStanza.getChildrenByFilter( function(child){
    return child.name === 'x' && child.attrs.xmlns === "jabber:x:data";
  },true)[0];

  result.messageCount = parseInt(formDataValue(formData,'message-count'));
  var messagePriority = formDataValue(formData,'last-message-priority');
  var messageBody = formDataValue(formData,'last-message-body');
  if (messagePriority === null) {
    if (messageBody !== null) {
      messagePriority = "high";
    } else {
      messagePriority = "low";
    }
  }
  
  var publishOptionsStanza = stanza.getChildrenByFilter( function(child){
    return child.name === 'publish-options';
  },true)[0];

  var token = null;
  if (typeof(publishOptionsStanza) !== "undefined" && publishOptionsStanza !== null) {

    var publishOptionsFormData = publishOptionsStanza.getChildrenByFilter( function(child){
      return child.name === 'x' && child.attrs.xmlns === "jabber:x:data";
    },true)[0];

    token = formDataValue(publishOptionsFormData,'token');
    endpointURL = formDataValue(publishOptionsFormData,'endpoint');
  }

  result.token = token;
  result.endpoint = endpointURL;
  result.priority = messagePriority;

  cb(null,result);
};

xmppServer.prototype.emitPushEvent = function(pushInfo) {
  if (pushInfo) {
    this.emit('push',pushInfo);
  }
};

xmppServer.prototype.handleStanza = function(stanza) {
  if (Disco.isDiscoQuery(stanza)) {
    //This is a disco query need to respond
    var that = this;
    Disco.discoResponse(stanza, function(err,response) {
      that.router.send(response);
    });

  } else {
    var that = this;
    parsePushStanza(stanza,function(err,result){
      if (result) {
        var fromJID = stanza.attrs.from;
        var toJID = stanza.attrs.to;
        var id = stanza.attrs.id;
        var response = new ltx.Element('iq',{'from':toJID,'to':fromJID,'id':id,'type':'result'});
        that.router.send(response);
        that.emitPushEvent(result);
      }
    });
  }
};


module.exports.parsePushStanza = parsePushStanza;
module.exports.xmppServer = xmppServer;
