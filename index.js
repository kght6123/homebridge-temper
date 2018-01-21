
const spawn = require('child_process').spawn;
const platformName = "TemperPlatform"

var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // アクセサリーはPlatformAccessoryコンストラクターから作成する必要があります。
    Accessory = homebridge.platformAccessory;

    // サービスと特性はhap-nodejsからのものです。
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    
    // プラットフォームプラグインを動的プラットフォームプラグインと見なすには、
    // registerPlatform(pluginName, platformName, constructor, dynamic),
    // dynamic は true でなければならない
    homebridge.registerPlatform("homebridge-temper", platformName, TemperPlatform, true);
}

// Platform constructor
// configがnullの場合がある
// 古いホームブリッジから起動した場合、apiはnullになることがあります
function TemperPlatform(log, config, api) {
    log(platformName +" Init");
    var platform = this;
    this.log = log;
    this.config = config;
    this.accessories = [];

    if (api 
        && platform.config.accessories
        && platform.config.accessories.length > 0) {
        // プラグインはこのオブジェクト経由で新しいアクセサリを登録する必要があるため、
        // APIオブジェクトを保存します。
        this.api = api;

        // "didFinishLaunching"イベントは、ホームブリッジがすでにアクセサリーのロードを完了して、キャッシュされたことを意味します。
        // Platform Pluginは、このイベントの後にhomebridgeに存在しない新しいアクセサリを登録してください。
        this.api.on('didFinishLaunching', function() {
            platform.log("didFinishLaunching");
            platform.config.accessories.forEach(accessoryConfig => {
                platform.addAccessory(accessoryConfig);
            });
        }.bind(this));
    }
}

// ホームブリッジがキャッシュされたアクセサリの復元を試みるときに呼び出される関数。
// 開発者はここでアクセサリを設定できます（セットアップイベントハンドラなど）。
// 現在の値を更新します。
TemperPlatform.prototype.configureAccessory = function(accessory) {
    this.log(accessory.displayName, "Configure Accessory");
    var platform = this;

    // プラグインが現在アクセサリを処理できる場合はアクセサリを到達可能に設定し、
    // それ以外の場合はfalseに設定し、後で呼び出すことによって到達可能性を更新します。
    // accessory.updateReachability()
    accessory.reachable = true;
    platform.config.accessories.forEach(accessoryConfig => {
        if(accessory.displayName == accessoryConfig.name) {
            this.log(accessory.displayName, "Recover Accessory");
            this._recoverAccessory(accessory, accessoryConfig);
        }
    });

    this.accessories.push(accessory);
}

// 開発者が外部イベントからアクセサリを動的に追加する方法を示すサンプル関数。
TemperPlatform.prototype.addAccessory = function(accessoryConfig) {
    this.log("Add Accessory");
    var platform = this;
    var uuid = UUIDGen.generate(accessoryConfig.name);

    // 同じUUIDのアクセサリがあったら追加せずに戻す。再度追加してしまうと落ちる。
    for (var index in this.accessories) {
        var accessory = this.accessories[index];
        if(accessory.UUID == uuid)
            return;
    }
    var newAccessory = new Accessory(accessoryConfig.name, uuid);

    // アクセサリのコンテキストを保存して configureAccessory() のアクセサリを復元するのに役立ちます。
    // newAccessory.context.something = "Something"
    this._recoverAccessory(newAccessory, accessoryConfig);

    this.accessories.push(newAccessory);
    this.api.registerPlatformAccessories("homebridge-temper", platformName, [newAccessory]);
}

TemperPlatform.prototype._recoverAccessory = function(accessory, accessoryConfig) {
    var platform = this;
    var serviceConfigs = accessoryConfig.services;
    accessory.on('identify', function(paired, callback) {
        platform.log(accessory.displayName, "Identify!!!");
        callback();
    });
    
    // サービスの名前を指定したことを確認してください。
    // そうでない場合、一部のHomeKitアプリケーションで表示されないことがあります。
    serviceConfigs.forEach(serviceConfig => {
        platform.log(accessory.displayName, serviceConfig.name);

        if(serviceConfig.type == "temp") {
            this._recoverService(accessory, Service.TemperatureSensor, serviceConfig.name, serviceConfig.subType)
                .getCharacteristic(Characteristic.CurrentTemperature)
                .on('get', function(callback, context) {
                    platform._spawn(serviceConfig.command, serviceConfig.param, function(data){
                        var temp;
                        if(accessoryConfig.type == "temper")
                            temp = data.split(",")[1];
                        else
                            temp = data.split(",")[0].split(":")[1].trim();
                        platform.log(accessory.displayName, "Temp("+accessoryConfig.type+") -> " + temp);
                        callback(null, parseFloat(temp));
                    })
                });
            
        } else if(serviceConfig.type == "hum") {
            this._recoverService(accessory, Service.HumiditySensor, serviceConfig.name, serviceConfig.subType)
                .getCharacteristic(Characteristic.CurrentRelativeHumidity)
                .on('get', function(callback, context) {
                    platform._spawn(serviceConfig.command, serviceConfig.param, function(data){
                        var hum;
                        if(accessoryConfig.type == "temper")
                            hum = "0";
                        else
                            hum = data.split(",")[1].split(":")[1].trim();
                        platform.log(accessory.displayName, "Hum("+accessoryConfig.type+") -> " + hum);
                        callback(null, parseFloat(hum));
                    })
                });
        }
    });
}
TemperPlatform.prototype._recoverService = function(accessory, serivceType, serviceName, subType) {
    var service;
    if (accessory.getService(serivceType)) {
        service = accessory.getService(serivceType, subType);
    } else {
        service = accessory.addService(serivceType, serviceName, subType);
    }
    return service;
}
TemperPlatform.prototype._spawn = function(command, param, stoutCallback) {
    var platform = this;
    let p = spawn(command, param, {env: process.env});
    p.on('exit', function (code) {
        platform.log("_spawn", 'child process exited.');
    });
    p.on('error', function (err) {
        platform.log("_spawn", err);
        process.exit(1);
    });
    p.stdout.setEncoding('utf-8');
    p.stdout.on('data', function (data) {
        platform.log("_spawn", data);
        stoutCallback.apply(this, [data]);
    });
    p.stderr.setEncoding('utf-8');
    p.stderr.on('data', function (data) {
        platform.log("_spawn", data);
    });
}
TemperPlatform.prototype.updateAccessoriesReachability = function() {
    this.log("Update Reachability");
    for (var index in this.accessories) {
        var accessory = this.accessories[index];
        accessory.updateReachability(false);
    }
}
