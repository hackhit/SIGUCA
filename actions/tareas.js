
var moment = require('moment');
var Marca = require('../models/Marca');
var Usuario = require('../models/Usuario');
var CierrePersonal = require('../models/CierrePersonal');
var util = require('../util/util');
var CronJob = require('cron').CronJob;
var crud = require('../routes/crud');
var crudHorario = require('../routes/crudHorario');
var crudSolicitud = require('../routes/crudSolicitud');
var crudJustificaciones = require('../routes/crudJustificaciones');


module.exports = {
    cierreAutomatico : new CronJob({
        //cronTime: '59 59 * * * 1-5', Lunes a Viernes a las 4:25:59
        //cronTime: '* * * * * *',
        cronTime: '00 50 23 * * 0-7',
        onTick: function() {
            //if(!once){
                crearCierre(moment().unix(), ejecutarCierre);
            //}
            //once = true;
        },
        start: false,
        timeZone: "America/Costa_Rica"
    })
}
var once = false;

function crearCierre(epoch, ejecutar){
    var hoy = new Date();
    var queryCierre = {epoch:epoch};
    CierrePersonal.find(queryCierre).exec(function(error, cierres) {
        if(error) 
            console.log("Error al crear cierre en la fecha '"+hoy+"' Mensaje: "+error);
        if(!cierres || cierres.length==0){
            var nuevoCierre = new CierrePersonal(queryCierre);
            nuevoCierre.save(function (err, cierre) {
                if (err) 
                    console.log("Error al crear cierre en la fecha '"+hoy+"' Mensaje: "+error);
                ejecutar(cierre._id);
            });
        } else{
            ejecutar(cierres[0]._id);
        }
    });
}

function ejecutarCierre(_idCierre){
    var hoy = new Date();
    console.log("Realizando cierre en la fecha '"+hoy+"' y notificando a usuarios");

    //Fechas para encontrar información del día
    var epochMin = moment();
    epochMin.hours(0);
    epochMin.minutes(0);
    epochMin.seconds(0);

    var epochMax = moment();
    epochMax.hours(23);
    epochMax.minutes(59);
    epochMax.seconds(59);

    //Se realiza el cierre para todos los usuarios menos el tipo administrador
    Usuario.find({tipo:{"$ne":"Administrador"}},{_id:1, nombre:1, horarioEmpleado:1}).exec(
        function(err, usuarios){
            if(!err){
                for(usuario in usuarios){
                    //console.log(usuarios[usuario]);
                    if(usuarios[usuario].horarioEmpleado && usuarios[usuario].horarioEmpleado!=""){
                        //console.log(usuarios[usuario].horarioEmpleado);
                        buscarHorario(_idCierre, usuarios[usuario]._id, 
                            epochMin, epochMax, usuarios[usuario].horarioEmpleado); 
                    }
                }
            } 
        });
}

function buscarHorario(_idCierre, _idUser, epochMin, epochMax, horarioEmpleado){
    crudHorario.getById(horarioEmpleado, 
        function(error, horario){
            if(!error && horario){
                buscarInformacionUsuarioCierre(
                    _idCierre, _idUser,epochMin, epochMax, horario);
            }
        });
}



function buscarInformacionUsuarioCierre(_idCierre, _idUser, epochMin, epochMax, horario){
    Marca.find(
    {
        usuario: _idUser,
        epoch: {
            "$gte": epochMin.unix(), 
            "$lte":epochMax.unix()
        }
    },
    {_id:0,tipoMarca:1,epoch:1}
    ).exec(function(error, marcasDelDia) {
        console.log(marcasDelDia);
        if (!error && marcasDelDia){
            var today = moment();
            var dia = ["domingo", "lunes", "martes", "miercoles", 
            "jueves", "viernes", "sabado"][today.day()];
            var marcas = util.clasificarMarcas(marcasDelDia);
            var tiempoDia = horario[dia];
            //Si entra a las 00:00 no contará ese día, en caso de ser así
            //el horario debería entrar como mínimo a las 00:01
            if((tiempoDia.entrada.hora!=0 || tiempoDia.entrada.minutos!=0)
                && (
                    tiempoDia.salida.hora>tiempoDia.entrada.hora ||
                    (tiempoDia.salida.hora==tiempoDia.entrada.hora
                        && tiempoDia.salida.minutos>tiempoDia.entrada.minutos)
                    )
                ){
                    //
                if(marcas.salida){
                    registroHorasRegulares(_idCierre, _idUser, marcas, tiempoDia);
                }
                else if(!marcas.entrada){
                    //console.log("Omisión de marca de entrada");
                    addJustIncompleta(_idUser, "Omisión de marca de entrada", "");
                    agregarUsuarioACierre(_idCierre, _idUser, {h:-1,m:-1});
                } 
                //Solo se genera una notificación de omisión de marca de salida si
                //el usuario incumplió las horas de trabajo
                else if(!marcas.salida){
                    //console.log("Omisión de marca de salida");
                    addJustIncompleta(_idUser, "Omisión de marca de salida", "");
                    agregarUsuarioACierre(_idCierre, _idUser, {h:-1,m:-1});
                }
                //registroHorasExtras(_idUser, marcas, epochMin, epochMax);
            }
        }
    });
}


function registroHorasRegulares(_idCierre, _idUser, marcas, tiempoDia){
    var tiempo = util.tiempoTotal(marcas);
    var hIn = tiempoDia.entrada;
    var hOut = tiempoDia.salida;
    var totalJornada = diferenciaHoras(hOut.hora, hOut.minutos, hIn.hora, hIn.minutos);
    var comparaH = util.compararHoras(tiempo.h, tiempo.m, totalJornada.h, totalJornada.m);
    agregarUsuarioACierre(_idCierre, _idUser, {h:tiempo.h,m:tiempo.m});
    if(comparaH==-1){
        addJustIncompleta(_idUser, "Jornada laborada menor que la establecida", 
            "Horas trabajadas: "+ util.horaStr(tiempo.h, tiempo.m)+
            " - Horas establecidas: "+ util.horaStr(totalJornada.h, totalJornada.m));
        //console.log("Jornada laborada menor que la establecida");
    }
    if(comparaH==1){
        addJustIncompleta(_idUser, "Jornada laborada mayor que la establecida",
            "Horas trabajadas: "+ util.horaStr(tiempo.h, tiempo.m)+
            " - Horas establecidas: "+ util.horaStr(totalJornada.h, totalJornada.m));
        //console.log("Jornada laborada mayor que la establecida");
    }
    return comparaH;
}

function registroHorasExtras(_idUser, marcas, epochMin, epochMax){
    //Si las horas extras es durante el periodo normal habría un mal cálculo,
    //ya que se sumarían las horas regulares y las extras. En este caso,
    //por ahora se harían cargo el departamento de recursos humanos.

    //Buscar epochInicio entre el intervalo de epochMin y epochMax
    /*var tiempo = util.tiempoTotal(marcas);
    var hIn = tiempoDia.entrada;
    var hOut = tiempoDia.salida;
    var totalJornada = diferenciaHoras(hOut.hora, hOut.minutos, hIn.hora, hIn.minutos);
    var comparaH = util.compararHoras(tiempo.h, tiempo.m, totalJornada.h, totalJornada.m);*/
    var queryEpoch = {
        "$gte":epochMin.unix(),
        "$lte":epochMax.unix()
    };
    var query = {
        "$or":[
            {usuario:_idUser, tipoSolicitudes:"Extras", epochInicio:queryEpoch},
            {usuario:_idUser, tipoSolicitudes:"Extras", epochTermino:queryEpoch}
        ]
    };
    crudSolicitud.get(query,
        function(err, extras){
            if(!err){
                for(e in extras){
                    var inicio = moment.unix(extras[e].epochInicio);
                    var fin = moment.unix(extras[e].epochTermino);
                    var tiempo = util.ajustarHoras(
                    {
                        h:fin.hour(),
                        m:fin.minutes()
                    },
                    {
                        h: inicio.hour(),
                        m:inicio.minutes()
                    }
                    );
                    console.log(tiempo);
                }
            }
        });
}

function agregarUsuarioACierre(_idCierre, _idUser, tiempo){
    var hoy = new Date();
    var query = {
        "$push":{
            "usuarios":{
                usuario: _idUser,
                tiempo: {
                    horas:tiempo.h,
                    minutos:tiempo.m
                }
            }
        }
    };
    CierrePersonal.findByIdAndUpdate(_idCierre, query, function (err, cierreActualizado) {
        if(err) 
            console.log("Error al actualizar cierre en la fecha '"+hoy+"' => Mensaje: "+error);
        //console.log(cierreActualizado);
    });
}

function addJustIncompleta(_idUser, motivo, informacion){
    crudJustificaciones.addJust(
        {id:_idUser, detalle:"", informacion: informacion,
        estado:"Incompleto", motivoJust:"otro",
        motivoOtroJust:motivo},
        function(){}
        ); 
}

function diferenciaHoras(hIn, mIn, hOut, mOut){
    if(mIn>=mOut) return {h:(hIn-hOut), m:(mIn-mOut)};
    if(mIn<mOut) return {h:(hIn-hOut)-1, m:60-(mOut-mIn)};
}  